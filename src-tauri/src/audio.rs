use crate::dto::{
    default_lane_states, lane_state_array, normalize_speed, AudioDiagnosticsDto, CompiledSession,
    LaneStateDto, LaneStateMapDto, LightPulseDto, MetronomeTickDto, PieceId, PlaybackControlsDto,
    PlaybackControlsPatchDto, PlaybackMode, PlaybackStatusDto, PIECE_COUNT,
};
use crate::kit::{choke_targets, is_lane_audible, piece, SampleBank};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, FromSample, Sample, SampleFormat, Stream, StreamConfig};
use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const COMMAND_CAPACITY: usize = 256;
const LIGHT_CAPACITY: usize = 4096;
const METRONOME_TICK_CAPACITY: usize = 1024;
const MAX_SAMPLE_VOICES: usize = 96;
const MAX_CLICK_VOICES: usize = 8;
const STATUS_INTERVAL: Duration = Duration::from_millis(16);
const MIN_LOOP_LENGTH_MS: f64 = 500.0;

#[derive(Debug)]
enum AudioCommand {
    ClearSession(String),
    Play {
        session: Arc<CompiledSession>,
        from_ms: f64,
        controls: PlaybackControlsDto,
        lane_states: [LaneStateDto; PIECE_COUNT],
    },
    Pause,
    Stop {
        reset_position: bool,
    },
    Seek {
        position_ms: f64,
    },
    SetControls(PlaybackControlsPatchDto),
    SetLaneStates([LaneStateDto; PIECE_COUNT]),
    Audition {
        piece_id: PieceId,
        velocity: f32,
    },
}

#[derive(Clone, Copy, Debug)]
struct AudioLight {
    piece_id: PieceId,
    note: u8,
    velocity: f32,
    at_position_ms: f64,
}

#[derive(Clone, Copy, Debug)]
struct AudioMetronomeTick {
    at_position_ms: f64,
}

#[derive(Clone, Copy)]
struct StatusSnapshot {
    is_playing: bool,
    mode: PlaybackMode,
    position_ms: f64,
    duration_ms: f64,
    speed: f64,
    loop_start_ms: f64,
    loop_end_ms: f64,
}

pub struct AudioBackend {
    tx: Option<Sender<AudioCommand>>,
    sessions: Mutex<HashMap<String, Arc<CompiledSession>>>,
    shared: Arc<SharedStatus>,
    init_error: Option<String>,
}

impl AudioBackend {
    pub fn new(app: AppHandle) -> Self {
        match AudioRuntime::start(app) {
            Ok(runtime) => Self {
                tx: Some(runtime.tx),
                sessions: Mutex::new(HashMap::new()),
                shared: runtime.shared,
                init_error: None,
            },
            Err(error) => Self {
                tx: None,
                sessions: Mutex::new(HashMap::new()),
                shared: Arc::new(SharedStatus::default()),
                init_error: Some(error),
            },
        }
    }

    pub fn insert_session(
        &self,
        session: CompiledSession,
    ) -> Result<crate::dto::SessionDto, String> {
        let dto = session.dto.clone();
        let session = Arc::new(session);
        self.sessions
            .lock()
            .map_err(|_| "Audio session store is unavailable.".to_string())?
            .insert(dto.session_id.clone(), session);
        self.shared.set_duration(dto.duration_ms);
        Ok(dto)
    }

    pub fn clear_session(&self, session_id: String) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|_| "Audio session store is unavailable.".to_string())?
            .remove(&session_id);
        self.send(AudioCommand::ClearSession(session_id))
    }

    pub fn play(
        &self,
        session_id: String,
        from_ms: f64,
        controls: PlaybackControlsDto,
        lane_states: LaneStateMapDto,
    ) -> Result<PlaybackStatusDto, String> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| "Audio session store is unavailable.".to_string())?
            .get(&session_id)
            .cloned()
            .ok_or_else(|| "The requested audio session is not loaded.".to_string())?;
        let mut controls = controls;
        controls.speed = normalize_speed(controls.speed);
        controls.master_volume = controls.master_volume.clamp(0.0, 1.0);
        self.shared.apply_playing_status(
            true,
            if controls.count_in_enabled && from_ms < 30.0 {
                PlaybackMode::CountIn
            } else {
                PlaybackMode::Playing
            },
            from_ms,
            session.dto.duration_ms,
            controls,
        );
        self.send(AudioCommand::Play {
            session,
            from_ms,
            controls,
            lane_states: lane_state_array(&lane_states),
        })?;
        Ok(self.shared.status())
    }

    pub fn pause(&self) -> Result<PlaybackStatusDto, String> {
        self.send(AudioCommand::Pause)?;
        self.shared.set_is_playing(false, PlaybackMode::Stopped);
        Ok(self.shared.status())
    }

    pub fn stop(&self, reset_position: bool) -> Result<PlaybackStatusDto, String> {
        self.send(AudioCommand::Stop { reset_position })?;
        self.shared.set_is_playing(false, PlaybackMode::Stopped);
        if reset_position {
            self.shared.set_position(0.0);
        }
        Ok(self.shared.status())
    }

    pub fn seek(&self, position_ms: f64) -> Result<PlaybackStatusDto, String> {
        self.send(AudioCommand::Seek { position_ms })?;
        self.shared.set_position(position_ms.max(0.0));
        Ok(self.shared.status())
    }

    pub fn set_controls(
        &self,
        patch: PlaybackControlsPatchDto,
    ) -> Result<PlaybackStatusDto, String> {
        self.shared.apply_controls_patch(patch);
        self.send(AudioCommand::SetControls(patch))?;
        Ok(self.shared.status())
    }

    pub fn set_lane_states(
        &self,
        lane_states: LaneStateMapDto,
    ) -> Result<PlaybackStatusDto, String> {
        self.send(AudioCommand::SetLaneStates(lane_state_array(&lane_states)))?;
        Ok(self.shared.status())
    }

    pub fn audition(&self, piece_id: PieceId, velocity: f32) -> Result<(), String> {
        self.send(AudioCommand::Audition {
            piece_id,
            velocity: velocity.clamp(0.0, 1.0),
        })
    }

    pub fn diagnostics(&self) -> AudioDiagnosticsDto {
        self.shared.diagnostics()
    }

    fn send(&self, command: AudioCommand) -> Result<(), String> {
        let tx = self.tx.as_ref().ok_or_else(|| {
            self.init_error
                .clone()
                .unwrap_or_else(|| "The native audio engine is not available.".to_string())
        })?;
        match tx.try_send(command) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => {
                self.shared
                    .dropped_command_count
                    .fetch_add(1, Ordering::Relaxed);
                Err("The audio engine command queue is full.".to_string())
            }
            Err(TrySendError::Disconnected(_)) => {
                Err("The audio engine command queue is disconnected.".to_string())
            }
        }
    }
}

struct AudioRuntime {
    tx: Sender<AudioCommand>,
    shared: Arc<SharedStatus>,
}

impl AudioRuntime {
    fn start(app: AppHandle) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "No default audio output device is available.".to_string())?;
        let supported = device
            .default_output_config()
            .map_err(|error| format!("Could not read the default output config: {error}"))?;
        let sample_rate = supported.sample_rate().0;
        let channels = supported.channels();
        let sample_bank = Arc::new(SampleBank::load(sample_rate)?);
        let shared = Arc::new(SharedStatus::new(sample_rate, channels));
        let (tx, rx) = bounded(COMMAND_CAPACITY);
        let (light_tx, light_rx) = bounded(LIGHT_CAPACITY);
        let (metronome_tick_tx, metronome_tick_rx) = bounded(METRONOME_TICK_CAPACITY);
        let (stream, buffer_size) = build_stream(
            &device,
            supported.sample_format(),
            supported.into(),
            sample_bank,
            rx,
            light_tx,
            metronome_tick_tx,
            shared.clone(),
        )?;
        shared.buffer_size.store(buffer_size, Ordering::Relaxed);
        stream
            .play()
            .map_err(|error| format!("Could not start the audio stream: {error}"))?;
        Box::leak(Box::new(stream));
        spawn_status_thread(app, shared.clone(), light_rx, metronome_tick_rx);
        Ok(Self { tx, shared })
    }
}

fn build_stream(
    device: &Device,
    sample_format: SampleFormat,
    default_config: StreamConfig,
    sample_bank: Arc<SampleBank>,
    rx: Receiver<AudioCommand>,
    light_tx: Sender<AudioLight>,
    metronome_tick_tx: Sender<AudioMetronomeTick>,
    shared: Arc<SharedStatus>,
) -> Result<(Stream, u32), String> {
    let attempts = [Some(128_u32), Some(256_u32), None];
    let mut last_error = None;

    for buffer_size in attempts {
        let mut config = default_config.clone();
        config.buffer_size = buffer_size
            .map(cpal::BufferSize::Fixed)
            .unwrap_or(cpal::BufferSize::Default);
        let result = match sample_format {
            SampleFormat::F32 => build_stream_for_format::<f32>(
                device,
                &config,
                sample_bank.clone(),
                rx.clone(),
                light_tx.clone(),
                metronome_tick_tx.clone(),
                shared.clone(),
            ),
            SampleFormat::I16 => build_stream_for_format::<i16>(
                device,
                &config,
                sample_bank.clone(),
                rx.clone(),
                light_tx.clone(),
                metronome_tick_tx.clone(),
                shared.clone(),
            ),
            SampleFormat::U16 => build_stream_for_format::<u16>(
                device,
                &config,
                sample_bank.clone(),
                rx.clone(),
                light_tx.clone(),
                metronome_tick_tx.clone(),
                shared.clone(),
            ),
            other => Err(format!("Unsupported audio sample format: {other:?}")),
        };

        match result {
            Ok(stream) => return Ok((stream, buffer_size.unwrap_or(0))),
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| "Could not build the audio stream.".to_string()))
}

fn build_stream_for_format<T>(
    device: &Device,
    config: &StreamConfig,
    sample_bank: Arc<SampleBank>,
    rx: Receiver<AudioCommand>,
    light_tx: Sender<AudioLight>,
    metronome_tick_tx: Sender<AudioMetronomeTick>,
    shared: Arc<SharedStatus>,
) -> Result<Stream, String>
where
    T: Sample + cpal::SizedSample + FromSample<f32>,
{
    let channels = usize::from(config.channels.max(1));
    let sample_rate = f64::from(config.sample_rate.0);
    let mut callback = CallbackState::new(
        sample_rate,
        sample_bank,
        rx,
        light_tx,
        metronome_tick_tx,
        shared.clone(),
    );
    let error_shared = shared;
    device
        .build_output_stream(
            config,
            move |output: &mut [T], _| callback.render(output, channels),
            move |_error| {
                error_shared.underrun_count.fetch_add(1, Ordering::Relaxed);
            },
            None,
        )
        .map_err(|error| format!("Could not build the output stream: {error}"))
}

#[derive(Clone, Copy)]
struct Voice {
    piece_id: PieceId,
    position: usize,
    gain: f32,
    // Fade-out envelope. While fade_total > 0, the voice's gain is multiplied
    // by (fade_remaining / fade_total) and fade_remaining decrements per frame.
    // The voice is dropped once fade_remaining reaches zero.
    fade_remaining: u32,
    fade_total: u32,
}

#[derive(Clone, Copy)]
struct ClickVoice {
    phase: f32,
    phase_step: f32,
    remaining: u32,
    total: u32,
    gain: f32,
    // Linear attack ramp to prevent click on transient onset.
    attack_remaining: u32,
    attack_total: u32,
}

const VOICE_FADE_CHOKE_MS: f32 = 10.0;
const CLICK_ATTACK_MS: f32 = 2.0;
const LIMITER_KNEE: f32 = 0.85;

struct CallbackState {
    sample_rate: f64,
    sample_bank: Arc<SampleBank>,
    rx: Receiver<AudioCommand>,
    light_tx: Sender<AudioLight>,
    metronome_tick_tx: Sender<AudioMetronomeTick>,
    shared: Arc<SharedStatus>,
    session: Option<Arc<CompiledSession>>,
    controls: PlaybackControlsDto,
    lane_states: [LaneStateDto; PIECE_COUNT],
    mode: PlaybackMode,
    position_ms: f64,
    event_index: usize,
    sample_voices: Vec<Voice>,
    click_voices: Vec<ClickVoice>,
    count_in_remaining_frames: u64,
    count_in_elapsed_frames: u64,
    count_in_next_click_frame: u64,
    count_in_beat: u8,
    next_metronome_ms: f64,
}

impl CallbackState {
    fn new(
        sample_rate: f64,
        sample_bank: Arc<SampleBank>,
        rx: Receiver<AudioCommand>,
        light_tx: Sender<AudioLight>,
        metronome_tick_tx: Sender<AudioMetronomeTick>,
        shared: Arc<SharedStatus>,
    ) -> Self {
        Self {
            sample_rate,
            sample_bank,
            rx,
            light_tx,
            metronome_tick_tx,
            shared,
            session: None,
            controls: PlaybackControlsDto::default(),
            lane_states: default_lane_states(),
            mode: PlaybackMode::Stopped,
            position_ms: 0.0,
            event_index: 0,
            sample_voices: Vec::with_capacity(MAX_SAMPLE_VOICES),
            click_voices: Vec::with_capacity(MAX_CLICK_VOICES),
            count_in_remaining_frames: 0,
            count_in_elapsed_frames: 0,
            count_in_next_click_frame: 0,
            count_in_beat: 0,
            next_metronome_ms: 0.0,
        }
    }

    fn render<T>(&mut self, output: &mut [T], channels: usize)
    where
        T: Sample + FromSample<f32>,
    {
        self.drain_commands();

        for frame in output.chunks_mut(channels) {
            let (left, right) = self.next_frame();
            for (index, sample) in frame.iter_mut().enumerate() {
                let value = if index % 2 == 0 { left } else { right }.clamp(-1.0, 1.0);
                *sample = T::from_sample(value);
            }
        }

        self.publish_status();
    }

    fn drain_commands(&mut self) {
        while let Ok(command) = self.rx.try_recv() {
            match command {
                AudioCommand::ClearSession(session_id) => {
                    if self
                        .session
                        .as_ref()
                        .is_some_and(|session| session.dto.session_id == session_id)
                    {
                        self.session = None;
                        self.stop(true);
                        self.shared.set_duration(0.0);
                    }
                }
                AudioCommand::Play {
                    session,
                    from_ms,
                    controls,
                    lane_states,
                } => self.play(session, from_ms, controls, lane_states),
                AudioCommand::Pause => self.pause(),
                AudioCommand::Stop { reset_position } => self.stop(reset_position),
                AudioCommand::Seek { position_ms } => self.seek(position_ms),
                AudioCommand::SetControls(patch) => {
                    self.controls.apply_patch(patch);
                    self.next_metronome_ms = self.next_beat_at_or_after(self.position_ms);
                    self.publish_status();
                }
                AudioCommand::SetLaneStates(lane_states) => self.lane_states = lane_states,
                AudioCommand::Audition { piece_id, velocity } => self.trigger_piece(
                    piece_id,
                    velocity.clamp(0.0, 1.0),
                    0,
                    self.position_ms,
                    false,
                ),
            }
        }
    }

    fn play(
        &mut self,
        session: Arc<CompiledSession>,
        from_ms: f64,
        mut controls: PlaybackControlsDto,
        lane_states: [LaneStateDto; PIECE_COUNT],
    ) {
        controls.speed = normalize_speed(controls.speed);
        controls.master_volume = controls.master_volume.clamp(0.0, 1.0);
        self.session = Some(session);
        self.controls = controls;
        self.lane_states = lane_states;
        self.position_ms = self.clamp_start_position(from_ms);
        self.event_index = self.hit_index_at_or_after(self.position_ms);
        self.sample_voices.clear();
        self.click_voices.clear();
        self.next_metronome_ms = self.next_beat_at_or_after(self.position_ms);

        if self.controls.count_in_enabled && self.position_ms < 30.0 {
            let beat_frames = self.beat_frames();
            self.mode = PlaybackMode::CountIn;
            self.count_in_remaining_frames = beat_frames * 4;
            self.count_in_elapsed_frames = 0;
            self.count_in_next_click_frame = 0;
            self.count_in_beat = 0;
        } else {
            self.mode = PlaybackMode::Playing;
            self.count_in_remaining_frames = 0;
        }

        self.publish_status();
    }

    fn pause(&mut self) {
        self.mode = PlaybackMode::Stopped;
        self.count_in_remaining_frames = 0;
        self.sample_voices.clear();
        self.click_voices.clear();
        self.publish_status();
    }

    fn stop(&mut self, reset_position: bool) {
        self.mode = PlaybackMode::Stopped;
        self.count_in_remaining_frames = 0;
        self.sample_voices.clear();
        self.click_voices.clear();
        if reset_position {
            self.position_ms = 0.0;
            self.event_index = 0;
        }
        self.publish_status();
    }

    fn seek(&mut self, position_ms: f64) {
        self.position_ms = self.clamp_start_position(position_ms);
        self.event_index = self.hit_index_at_or_after(self.position_ms);
        self.next_metronome_ms = self.next_beat_at_or_after(self.position_ms);
        self.publish_status();
    }

    fn next_frame(&mut self) -> (f32, f32) {
        if matches!(self.mode, PlaybackMode::CountIn) {
            self.advance_count_in();
        }

        if matches!(self.mode, PlaybackMode::Playing) {
            self.trigger_due_events();
            self.trigger_due_metronome();
        }

        let (mut left, mut right) = self.mix_active_voices();
        left *= self.controls.master_volume;
        right *= self.controls.master_volume;
        left = soft_limit(left);
        right = soft_limit(right);

        if matches!(self.mode, PlaybackMode::Playing) {
            self.advance_playhead();
        }

        (left, right)
    }

    fn advance_count_in(&mut self) {
        if self.count_in_remaining_frames == 0 {
            self.mode = PlaybackMode::Playing;
            self.next_metronome_ms = self.next_beat_at_or_after(self.position_ms);
            return;
        }

        if self.count_in_beat < 4 && self.count_in_elapsed_frames >= self.count_in_next_click_frame
        {
            let high = self.count_in_beat == 3;
            self.trigger_click(if high { 2093.0 } else { 1046.5 }, 0.04, 0.34);
            self.count_in_beat += 1;
            self.count_in_next_click_frame = self
                .count_in_next_click_frame
                .saturating_add(self.beat_frames());
        }

        self.count_in_elapsed_frames = self.count_in_elapsed_frames.saturating_add(1);
        self.count_in_remaining_frames = self.count_in_remaining_frames.saturating_sub(1);
        if self.count_in_remaining_frames == 0 {
            self.mode = PlaybackMode::Playing;
            self.next_metronome_ms = self.next_beat_at_or_after(self.position_ms);
        }
    }

    fn advance_playhead(&mut self) {
        let speed = normalize_speed(self.controls.speed);
        self.position_ms += 1000.0 * speed / self.sample_rate;

        if self.loop_active() {
            let (loop_start, loop_end) = self.sanitized_loop();
            if self.position_ms >= loop_end {
                let loop_len = (loop_end - loop_start).max(MIN_LOOP_LENGTH_MS);
                let overrun = (self.position_ms - loop_end) % loop_len;
                self.position_ms = loop_start + overrun;
                self.event_index = self.hit_index_at_or_after(loop_start);
                self.next_metronome_ms = self.next_beat_at_or_after(loop_start);
            }
        } else if let Some(session) = &self.session {
            if self.position_ms >= session.dto.duration_ms {
                self.position_ms = session.dto.duration_ms;
                self.mode = PlaybackMode::Stopped;
                self.sample_voices.clear();
                self.click_voices.clear();
            }
        }
    }

    fn trigger_due_events(&mut self) {
        // Cloning the Arc here is intentional: a borrow conflict with the
        // `&mut self` call to trigger_piece() below otherwise prevents
        // iteration. The clone is one atomic fetch_add per call (~5ns at this
        // call rate) and keeps the trigger path real-time-safe.
        let Some(session) = self.session.clone() else {
            return;
        };
        let (loop_start, loop_end) = self.sanitized_loop();
        let loop_active = self.loop_active();

        while let Some(hit) = session.hits.get(self.event_index).copied() {
            if loop_active && hit.time_ms < loop_start {
                self.event_index += 1;
                continue;
            }
            if loop_active && hit.time_ms >= loop_end {
                break;
            }
            if hit.time_ms > self.position_ms + 0.0001 {
                break;
            }

            self.trigger_piece(hit.piece_id, hit.velocity, hit.note, hit.time_ms, false);
            self.event_index += 1;
        }
    }

    fn trigger_due_metronome(&mut self) {
        if !self.controls.metronome_enabled {
            return;
        }

        let beat_ms = self.beat_ms();
        while self.next_metronome_ms <= self.position_ms + 0.0001 {
            let at_position_ms = self.next_metronome_ms;
            self.trigger_click(1046.5, 0.03, 0.26);
            let _ = self
                .metronome_tick_tx
                .try_send(AudioMetronomeTick { at_position_ms });
            self.next_metronome_ms += beat_ms;
        }
    }

    fn trigger_piece(
        &mut self,
        piece_id: PieceId,
        velocity: f32,
        note: u8,
        at_position_ms: f64,
        force: bool,
    ) {
        if !force && !is_lane_audible(piece_id, &self.lane_states) {
            return;
        }

        let lane = self.lane_states[piece_id.index()];
        let gain = velocity.clamp(0.0, 1.0) * lane.volume.clamp(0.0, 1.0);
        if gain <= 0.0 {
            return;
        }

        for target in choke_targets(piece_id) {
            self.stop_piece_voices(*target);
        }

        if self.sample_voices.len() >= MAX_SAMPLE_VOICES {
            self.sample_voices.remove(0);
        }
        self.sample_voices.push(Voice {
            piece_id,
            position: 0,
            gain,
            fade_remaining: 0,
            fade_total: 0,
        });

        let light = AudioLight {
            piece_id,
            note,
            velocity,
            at_position_ms,
        };
        if self.light_tx.try_send(light).is_err() {
            self.shared
                .dropped_light_count
                .fetch_add(1, Ordering::Relaxed);
        }
    }

    fn stop_piece_voices(&mut self, piece_id: PieceId) {
        let fade_samples = ((self.sample_rate as f32) * VOICE_FADE_CHOKE_MS / 1000.0) as u32;
        let fade_samples = fade_samples.max(1);
        for voice in &mut self.sample_voices {
            if voice.piece_id == piece_id {
                start_fade(voice, fade_samples);
            }
        }
    }

    fn trigger_click(&mut self, frequency: f32, seconds: f32, gain: f32) {
        if self.click_voices.len() >= MAX_CLICK_VOICES {
            self.click_voices.remove(0);
        }
        let total = (self.sample_rate as f32 * seconds).max(1.0) as u32;
        let attack_total = ((self.sample_rate as f32) * CLICK_ATTACK_MS / 1000.0)
            .max(1.0) as u32;
        let attack_total = attack_total.min(total);
        self.click_voices.push(ClickVoice {
            phase: 0.0,
            phase_step: frequency / self.sample_rate as f32,
            remaining: total,
            total,
            gain,
            attack_remaining: attack_total,
            attack_total,
        });
    }

    fn mix_active_voices(&mut self) -> (f32, f32) {
        let mut left = 0.0_f32;
        let mut right = 0.0_f32;

        let mut voice_index = 0;
        while voice_index < self.sample_voices.len() {
            let voice = self.sample_voices[voice_index];
            let sample = self.sample_bank.get(voice.piece_id);
            let fade_done = voice.fade_total > 0 && voice.fade_remaining == 0;
            if voice.position >= sample.len() || fade_done {
                self.sample_voices.swap_remove(voice_index);
                continue;
            }

            let fade_factor = if voice.fade_total > 0 {
                voice.fade_remaining as f32 / voice.fade_total as f32
            } else {
                1.0
            };
            let g = voice.gain * fade_factor;
            left += sample.left[voice.position] * g;
            right += sample.right[voice.position] * g;
            let v = &mut self.sample_voices[voice_index];
            v.position += 1;
            if v.fade_total > 0 && v.fade_remaining > 0 {
                v.fade_remaining -= 1;
            }
            voice_index += 1;
        }

        let mut click_index = 0;
        while click_index < self.click_voices.len() {
            let click = &mut self.click_voices[click_index];
            if click.remaining == 0 {
                self.click_voices.swap_remove(click_index);
                continue;
            }

            let decay = click.remaining as f32 / click.total.max(1) as f32;
            let attack = if click.attack_total > 0 {
                let elapsed = click.attack_total - click.attack_remaining;
                elapsed as f32 / click.attack_total as f32
            } else {
                1.0
            };
            let osc = (click.phase * std::f32::consts::TAU).sin();
            let value = osc * click.gain * decay * attack;
            left += value;
            right += value;
            click.phase = (click.phase + click.phase_step) % 1.0;
            click.remaining -= 1;
            if click.attack_remaining > 0 {
                click.attack_remaining -= 1;
            }
            click_index += 1;
        }

        (left, right)
    }

    fn hit_index_at_or_after(&self, position_ms: f64) -> usize {
        self.session
            .as_ref()
            .map(|session| {
                session
                    .hits
                    .partition_point(|hit| hit.time_ms < position_ms)
            })
            .unwrap_or(0)
    }

    fn clamp_start_position(&self, position_ms: f64) -> f64 {
        let Some(session) = &self.session else {
            return 0.0;
        };
        let position_ms = position_ms.max(0.0);
        if self.loop_active() {
            let (loop_start, loop_end) = self.sanitized_loop();
            position_ms.clamp(loop_start, loop_end - 1.0)
        } else {
            position_ms.clamp(0.0, session.dto.duration_ms)
        }
    }

    fn sanitized_loop(&self) -> (f64, f64) {
        let duration_ms = self
            .session
            .as_ref()
            .map(|session| session.dto.duration_ms)
            .unwrap_or(0.0)
            .max(0.0);
        if duration_ms < MIN_LOOP_LENGTH_MS {
            return (0.0, duration_ms);
        }

        let start = self
            .controls
            .loop_start_ms
            .clamp(0.0, (duration_ms - MIN_LOOP_LENGTH_MS).max(0.0));
        let end = self
            .controls
            .loop_end_ms
            .clamp(start + MIN_LOOP_LENGTH_MS, duration_ms);
        (start, end)
    }

    fn loop_active(&self) -> bool {
        if !self.controls.loop_enabled {
            return false;
        }
        let (start, end) = self.sanitized_loop();
        end - start >= MIN_LOOP_LENGTH_MS
    }

    fn beat_ms(&self) -> f64 {
        let bpm = self
            .session
            .as_ref()
            .map(|session| session.dto.bpm)
            .unwrap_or(120.0)
            .max(40.0);
        60_000.0 / bpm
    }

    fn beat_frames(&self) -> u64 {
        (self.sample_rate * self.beat_ms() / 1000.0 / normalize_speed(self.controls.speed))
            .round()
            .max(1.0) as u64
    }

    fn next_beat_at_or_after(&self, position_ms: f64) -> f64 {
        let beat_ms = self.beat_ms();
        (position_ms.max(0.0) / beat_ms).ceil() * beat_ms
    }

    fn publish_status(&self) {
        let duration_ms = self
            .session
            .as_ref()
            .map(|session| session.dto.duration_ms)
            .unwrap_or(0.0);
        let (loop_start_ms, loop_end_ms) = self.sanitized_loop();
        self.shared.apply_status(StatusSnapshot {
            is_playing: !matches!(self.mode, PlaybackMode::Stopped),
            mode: self.mode,
            position_ms: self.position_ms,
            duration_ms,
            speed: normalize_speed(self.controls.speed),
            loop_start_ms,
            loop_end_ms,
        });
    }
}

#[derive(Default)]
struct SharedStatus {
    is_playing: AtomicBool,
    mode: AtomicU8,
    position_ms: AtomicU64,
    duration_ms: AtomicU64,
    speed: AtomicU64,
    loop_start_ms: AtomicU64,
    loop_end_ms: AtomicU64,
    output_sample_rate: AtomicU32,
    output_channels: AtomicU32,
    buffer_size: AtomicU32,
    underrun_count: AtomicU64,
    dropped_light_count: AtomicU64,
    dropped_command_count: AtomicU64,
}

impl SharedStatus {
    fn new(output_sample_rate: u32, output_channels: u16) -> Self {
        let status = Self::default();
        status
            .output_sample_rate
            .store(output_sample_rate, Ordering::Relaxed);
        status
            .output_channels
            .store(u32::from(output_channels), Ordering::Relaxed);
        status.speed.store(1.0_f64.to_bits(), Ordering::Relaxed);
        status
    }

    fn status(&self) -> PlaybackStatusDto {
        PlaybackStatusDto {
            is_playing: self.is_playing.load(Ordering::Relaxed),
            mode: self.mode(),
            position_ms: f64::from_bits(self.position_ms.load(Ordering::Relaxed)),
            duration_ms: f64::from_bits(self.duration_ms.load(Ordering::Relaxed)),
            speed: f64::from_bits(self.speed.load(Ordering::Relaxed)),
            loop_start_ms: f64::from_bits(self.loop_start_ms.load(Ordering::Relaxed)),
            loop_end_ms: f64::from_bits(self.loop_end_ms.load(Ordering::Relaxed)),
            generated_at_ns: now_ns(),
        }
    }

    fn diagnostics(&self) -> AudioDiagnosticsDto {
        AudioDiagnosticsDto {
            output_sample_rate: self.output_sample_rate.load(Ordering::Relaxed),
            output_channels: self.output_channels.load(Ordering::Relaxed) as u16,
            buffer_size: self.buffer_size.load(Ordering::Relaxed),
            underrun_count: self.underrun_count.load(Ordering::Relaxed),
            dropped_light_count: self.dropped_light_count.load(Ordering::Relaxed),
            dropped_command_count: self.dropped_command_count.load(Ordering::Relaxed),
        }
    }

    fn set_position(&self, position_ms: f64) {
        self.position_ms
            .store(position_ms.max(0.0).to_bits(), Ordering::Relaxed);
    }

    fn set_duration(&self, duration_ms: f64) {
        self.duration_ms
            .store(duration_ms.max(0.0).to_bits(), Ordering::Relaxed);
    }

    fn set_is_playing(&self, is_playing: bool, mode: PlaybackMode) {
        self.is_playing.store(is_playing, Ordering::Relaxed);
        self.mode.store(mode_to_u8(mode), Ordering::Relaxed);
    }

    fn apply_playing_status(
        &self,
        is_playing: bool,
        mode: PlaybackMode,
        position_ms: f64,
        duration_ms: f64,
        controls: PlaybackControlsDto,
    ) {
        self.apply_status(StatusSnapshot {
            is_playing,
            mode,
            position_ms,
            duration_ms,
            speed: normalize_speed(controls.speed),
            loop_start_ms: controls.loop_start_ms,
            loop_end_ms: controls.loop_end_ms,
        });
    }

    fn apply_controls_patch(&self, patch: PlaybackControlsPatchDto) {
        if let Some(speed) = patch.speed {
            self.speed
                .store(normalize_speed(speed).to_bits(), Ordering::Relaxed);
        }
        if let Some(loop_start_ms) = patch.loop_start_ms {
            self.loop_start_ms
                .store(loop_start_ms.max(0.0).to_bits(), Ordering::Relaxed);
        }
        if let Some(loop_end_ms) = patch.loop_end_ms {
            self.loop_end_ms
                .store(loop_end_ms.max(0.0).to_bits(), Ordering::Relaxed);
        }
    }

    fn apply_status(&self, status: StatusSnapshot) {
        self.is_playing.store(status.is_playing, Ordering::Relaxed);
        self.mode.store(mode_to_u8(status.mode), Ordering::Relaxed);
        self.position_ms
            .store(status.position_ms.max(0.0).to_bits(), Ordering::Relaxed);
        self.duration_ms
            .store(status.duration_ms.max(0.0).to_bits(), Ordering::Relaxed);
        self.speed
            .store(normalize_speed(status.speed).to_bits(), Ordering::Relaxed);
        self.loop_start_ms
            .store(status.loop_start_ms.max(0.0).to_bits(), Ordering::Relaxed);
        self.loop_end_ms
            .store(status.loop_end_ms.max(0.0).to_bits(), Ordering::Relaxed);
    }

    fn mode(&self) -> PlaybackMode {
        match self.mode.load(Ordering::Relaxed) {
            1 => PlaybackMode::Playing,
            2 => PlaybackMode::CountIn,
            _ => PlaybackMode::Stopped,
        }
    }
}

fn mode_to_u8(mode: PlaybackMode) -> u8 {
    match mode {
        PlaybackMode::Stopped => 0,
        PlaybackMode::Playing => 1,
        PlaybackMode::CountIn => 2,
    }
}

fn spawn_status_thread(
    app: AppHandle,
    shared: Arc<SharedStatus>,
    light_rx: Receiver<AudioLight>,
    metronome_tick_rx: Receiver<AudioMetronomeTick>,
) {
    std::thread::spawn(move || {
        let mut diagnostics_tick = 0_u8;
        loop {
            let mut lights = Vec::new();
            while let Ok(light) = light_rx.try_recv() {
                let kit_piece = piece(light.piece_id);
                lights.push(LightPulseDto {
                    piece_id: light.piece_id,
                    note: light.note,
                    velocity: light.velocity,
                    intensity: light.velocity.clamp(0.0, 1.0),
                    color: kit_piece.color.clone(),
                    duration_ms: kit_piece.light_duration_ms,
                    at_position_ms: light.at_position_ms,
                });
            }

            if !lights.is_empty() {
                let _ = app.emit("audio:lights", lights);
            }

            let mut metronome_ticks = Vec::new();
            while let Ok(tick) = metronome_tick_rx.try_recv() {
                metronome_ticks.push(MetronomeTickDto {
                    at_position_ms: tick.at_position_ms,
                });
            }

            if !metronome_ticks.is_empty() {
                let _ = app.emit("audio:metronome-ticks", metronome_ticks);
            }

            let _ = app.emit("audio:status", shared.status());
            if diagnostics_tick == 0 {
                let _ = app.emit("audio:diagnostics", shared.diagnostics());
            }
            diagnostics_tick = (diagnostics_tick + 1) % 60;
            std::thread::sleep(STATUS_INTERVAL);
        }
    });
}

fn now_ns() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

// Begin a linear fade-out on `voice` over `samples` frames. If the voice is already
// fading at a faster rate, leave it alone — re-arming a slower fade would let a
// choked voice ring out longer than intended.
fn start_fade(voice: &mut Voice, samples: u32) {
    let samples = samples.max(1);
    if voice.fade_total > 0 && voice.fade_remaining < samples {
        return;
    }
    voice.fade_total = samples;
    voice.fade_remaining = samples;
}

// Soft-knee limiter on the master bus. Below LIMITER_KNEE the signal is unchanged;
// above it, the excess is shaped through (1 - exp(-x)) so the ceiling at 1.0 is
// approached asymptotically and the hard `clamp` in render() never has to act.
// Cost is one branch + one exp per channel — negligible at audio rates.
fn soft_limit(value: f32) -> f32 {
    let abs = value.abs();
    if abs <= LIMITER_KNEE {
        return value;
    }
    let over = abs - LIMITER_KNEE;
    let head = 1.0 - LIMITER_KNEE;
    let shaped = LIMITER_KNEE + head * (1.0 - (-over / head).exp());
    if value >= 0.0 {
        shaped
    } else {
        -shaped
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::{CompiledHit, SessionDto};

    fn test_session() -> Arc<CompiledSession> {
        Arc::new(CompiledSession {
            dto: SessionDto {
                session_id: "test".to_string(),
                label: "test.mid".to_string(),
                name: "test".to_string(),
                duration_ms: 2000.0,
                ppq: 480,
                bpm: 120.0,
                hits: Vec::new(),
                unmapped_notes: Vec::new(),
                tracks: Vec::new(),
            },
            hits: vec![
                CompiledHit {
                    time_ms: 0.0,
                    note: 36,
                    velocity: 1.0,
                    piece_id: PieceId::Kick,
                },
                CompiledHit {
                    time_ms: 500.0,
                    note: 42,
                    velocity: 0.5,
                    piece_id: PieceId::ClosedHat,
                },
            ],
        })
    }

    fn test_state() -> CallbackState {
        let (tx, rx) = bounded(8);
        drop(tx);
        let (light_tx, _light_rx) = bounded(8);
        let (metronome_tick_tx, _metronome_tick_rx) = bounded(8);
        CallbackState::new(
            1000.0,
            Arc::new(SampleBank::load(1000).expect("samples decode")),
            rx,
            light_tx,
            metronome_tick_tx,
            Arc::new(SharedStatus::new(1000, 2)),
        )
    }

    #[test]
    fn scheduler_advances_at_speed() {
        let mut state = test_state();
        state.play(
            test_session(),
            0.0,
            PlaybackControlsDto {
                speed: 2.0,
                ..PlaybackControlsDto::default()
            },
            default_lane_states(),
        );

        for _ in 0..250 {
            state.next_frame();
        }

        assert!((state.position_ms - 500.0).abs() < 0.01);
    }

    #[test]
    fn loop_wraps_without_stopping() {
        let mut state = test_state();
        state.play(
            test_session(),
            900.0,
            PlaybackControlsDto {
                loop_enabled: true,
                loop_start_ms: 500.0,
                loop_end_ms: 1000.0,
                ..PlaybackControlsDto::default()
            },
            default_lane_states(),
        );

        for _ in 0..200 {
            state.next_frame();
        }

        assert!(matches!(state.mode, PlaybackMode::Playing));
        assert!(state.position_ms >= 500.0 && state.position_ms < 1000.0);
    }

    #[test]
    fn loop_wrap_triggers_hit_at_loop_start_after_overrun() {
        let mut state = test_state();
        state.play(
            test_session(),
            999.0,
            PlaybackControlsDto {
                speed: 2.0,
                loop_enabled: true,
                loop_start_ms: 500.0,
                loop_end_ms: 1000.0,
                ..PlaybackControlsDto::default()
            },
            default_lane_states(),
        );

        state.next_frame();
        assert!((state.position_ms - 501.0).abs() < 0.01);

        state.next_frame();
        assert!(state
            .sample_voices
            .iter()
            .any(|voice| voice.piece_id == PieceId::ClosedHat));
    }

    #[test]
    fn loop_wrap_keeps_metronome_click_at_loop_start_after_overrun() {
        let mut state = test_state();
        state.play(
            test_session(),
            999.0,
            PlaybackControlsDto {
                speed: 2.0,
                loop_enabled: true,
                loop_start_ms: 500.0,
                loop_end_ms: 1000.0,
                metronome_enabled: true,
                ..PlaybackControlsDto::default()
            },
            default_lane_states(),
        );

        state.next_frame();
        assert!((state.position_ms - 501.0).abs() < 0.01);
        assert!((state.next_metronome_ms - 500.0).abs() < 0.01);

        state.next_frame();
        assert!(!state.click_voices.is_empty());
        assert!((state.next_metronome_ms - 1000.0).abs() < 0.01);
    }

    #[test]
    fn muted_lanes_do_not_spawn_voices() {
        let mut state = test_state();
        let mut lanes = default_lane_states();
        lanes[PieceId::Kick.index()].muted = true;
        state.play(test_session(), 0.0, PlaybackControlsDto::default(), lanes);
        state.next_frame();

        assert!(state.sample_voices.is_empty());
    }

    #[test]
    fn status_before_session_does_not_panic() {
        let state = test_state();

        state.publish_status();

        let status = state.shared.status();
        assert_eq!(status.duration_ms, 0.0);
        assert_eq!(status.loop_start_ms, 0.0);
        assert_eq!(status.loop_end_ms, 0.0);
    }

    #[test]
    fn soft_limit_passes_quiet_signals() {
        assert!((soft_limit(0.5) - 0.5).abs() < 1e-6);
        assert!((soft_limit(-0.5) + 0.5).abs() < 1e-6);
        assert!((soft_limit(LIMITER_KNEE) - LIMITER_KNEE).abs() < 1e-6);
    }

    #[test]
    fn soft_limit_clamps_loud_signals_at_or_below_one() {
        for value in [1.5_f32, 2.0, 5.0, 100.0] {
            let limited = soft_limit(value);
            assert!(limited > LIMITER_KNEE);
            assert!(limited <= 1.0, "expected {limited} <= 1.0 for input {value}");
            let neg = soft_limit(-value);
            assert!(neg < -LIMITER_KNEE);
            assert!(neg >= -1.0);
        }
    }

    #[test]
    fn start_fade_arms_envelope() {
        let mut voice = Voice {
            piece_id: PieceId::Kick,
            position: 100,
            gain: 1.0,
            fade_remaining: 0,
            fade_total: 0,
        };
        start_fade(&mut voice, 480);
        assert_eq!(voice.fade_total, 480);
        assert_eq!(voice.fade_remaining, 480);
    }

    #[test]
    fn start_fade_does_not_extend_active_faster_fade() {
        let mut voice = Voice {
            piece_id: PieceId::Kick,
            position: 100,
            gain: 1.0,
            fade_remaining: 100,
            fade_total: 240,
        };
        // Already mid-fade with 100 frames left; a new 480-frame fade would slow it
        // down — must be ignored.
        start_fade(&mut voice, 480);
        assert_eq!(voice.fade_remaining, 100);
        assert_eq!(voice.fade_total, 240);
    }
}
