use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const PIECE_COUNT: usize = 9;

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PieceId {
    Kick,
    Snare,
    Clap,
    ClosedHat,
    OpenHat,
    LowTom,
    MidTom,
    Crash,
    Ride,
}

impl PieceId {
    pub const ALL: [PieceId; PIECE_COUNT] = [
        PieceId::Kick,
        PieceId::Snare,
        PieceId::Clap,
        PieceId::ClosedHat,
        PieceId::OpenHat,
        PieceId::LowTom,
        PieceId::MidTom,
        PieceId::Crash,
        PieceId::Ride,
    ];

    pub const fn index(self) -> usize {
        match self {
            PieceId::Kick => 0,
            PieceId::Snare => 1,
            PieceId::Clap => 2,
            PieceId::ClosedHat => 3,
            PieceId::OpenHat => 4,
            PieceId::LowTom => 5,
            PieceId::MidTom => 6,
            PieceId::Crash => 7,
            PieceId::Ride => 8,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitPieceDto {
    pub id: PieceId,
    pub label: String,
    pub short_label: String,
    pub midi_notes: Vec<u8>,
    pub sample_url: String,
    pub color: String,
    pub light_duration_ms: f64,
    pub x: f64,
    pub y: f64,
    pub size: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitDto {
    pub id: String,
    pub name: String,
    pub source: String,
    pub license: String,
    pub pieces: Vec<KitPieceDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiHitDto {
    pub id: String,
    pub tick: u64,
    pub time_ms: f64,
    pub duration_ms: f64,
    pub note: u8,
    pub note_name: String,
    pub velocity: f64,
    pub channel: u8,
    pub piece_id: PieceId,
    pub track_index: usize,
    pub track_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmappedMidiNoteDto {
    pub note: u8,
    pub note_name: String,
    pub channel: u8,
    pub track_name: String,
    pub count: usize,
    pub first_time_ms: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiTrackSummaryDto {
    pub index: usize,
    pub name: String,
    pub channel: u8,
    pub instrument: String,
    pub note_count: usize,
    pub mapped_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDto {
    pub session_id: String,
    pub label: String,
    pub name: String,
    pub duration_ms: f64,
    pub ppq: u16,
    pub bpm: f64,
    pub hits: Vec<MidiHitDto>,
    pub unmapped_notes: Vec<UnmappedMidiNoteDto>,
    pub tracks: Vec<MidiTrackSummaryDto>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaneStateDto {
    pub volume: f32,
    pub muted: bool,
    pub soloed: bool,
}

impl Default for LaneStateDto {
    fn default() -> Self {
        Self {
            volume: 0.9,
            muted: false,
            soloed: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackControlsDto {
    pub speed: f64,
    pub loop_enabled: bool,
    pub loop_start_ms: f64,
    pub loop_end_ms: f64,
    pub count_in_enabled: bool,
    pub metronome_enabled: bool,
    pub master_volume: f32,
}

impl Default for PlaybackControlsDto {
    fn default() -> Self {
        Self {
            speed: 1.0,
            loop_enabled: false,
            loop_start_ms: 0.0,
            loop_end_ms: 4000.0,
            count_in_enabled: false,
            metronome_enabled: false,
            master_volume: 0.85,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackControlsPatchDto {
    pub speed: Option<f64>,
    pub loop_enabled: Option<bool>,
    pub loop_start_ms: Option<f64>,
    pub loop_end_ms: Option<f64>,
    pub count_in_enabled: Option<bool>,
    pub metronome_enabled: Option<bool>,
    pub master_volume: Option<f32>,
}

impl PlaybackControlsDto {
    pub fn apply_patch(&mut self, patch: PlaybackControlsPatchDto) {
        if let Some(speed) = patch.speed {
            self.speed = normalize_speed(speed);
        }
        if let Some(loop_enabled) = patch.loop_enabled {
            self.loop_enabled = loop_enabled;
        }
        if let Some(loop_start_ms) = patch.loop_start_ms {
            self.loop_start_ms = loop_start_ms.max(0.0);
        }
        if let Some(loop_end_ms) = patch.loop_end_ms {
            self.loop_end_ms = loop_end_ms.max(0.0);
        }
        if let Some(count_in_enabled) = patch.count_in_enabled {
            self.count_in_enabled = count_in_enabled;
        }
        if let Some(metronome_enabled) = patch.metronome_enabled {
            self.metronome_enabled = metronome_enabled;
        }
        if let Some(master_volume) = patch.master_volume {
            self.master_volume = master_volume.clamp(0.0, 1.0);
        }
    }
}

pub type LaneStateMapDto = HashMap<PieceId, LaneStateDto>;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackMode {
    Stopped,
    Playing,
    CountIn,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatusDto {
    pub is_playing: bool,
    pub mode: PlaybackMode,
    pub position_ms: f64,
    pub duration_ms: f64,
    pub speed: f64,
    pub loop_start_ms: f64,
    pub loop_end_ms: f64,
    pub generated_at_ns: u64,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDiagnosticsDto {
    pub output_sample_rate: u32,
    pub output_channels: u16,
    pub buffer_size: u32,
    pub underrun_count: u64,
    pub dropped_light_count: u64,
    pub dropped_command_count: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightPulseDto {
    pub piece_id: PieceId,
    pub note: u8,
    pub velocity: f32,
    pub intensity: f32,
    pub color: String,
    pub duration_ms: f64,
    pub at_position_ms: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct CompiledHit {
    pub time_ms: f64,
    pub note: u8,
    pub velocity: f32,
    pub piece_id: PieceId,
}

#[derive(Clone, Debug)]
pub struct CompiledSession {
    pub dto: SessionDto,
    pub hits: Vec<CompiledHit>,
}

impl CompiledSession {
    pub fn from_dto(dto: SessionDto) -> Self {
        let hits = dto
            .hits
            .iter()
            .map(|hit| CompiledHit {
                time_ms: hit.time_ms,
                note: hit.note,
                velocity: hit.velocity.clamp(0.0, 1.0) as f32,
                piece_id: hit.piece_id,
            })
            .collect();
        Self { dto, hits }
    }
}

pub fn normalize_speed(speed: f64) -> f64 {
    if speed.is_finite() {
        speed.clamp(0.25, 2.0)
    } else {
        1.0
    }
}

pub fn default_lane_states() -> [LaneStateDto; PIECE_COUNT] {
    [LaneStateDto::default(); PIECE_COUNT]
}

pub fn lane_state_array(map: &LaneStateMapDto) -> [LaneStateDto; PIECE_COUNT] {
    let mut states = default_lane_states();
    for piece_id in PieceId::ALL {
        if let Some(state) = map.get(&piece_id) {
            states[piece_id.index()] = LaneStateDto {
                volume: state.volume.clamp(0.0, 1.0),
                muted: state.muted,
                soloed: state.soloed,
            };
        }
    }
    states
}
