use crate::dto::{MidiHitDto, MidiTrackSummaryDto, SessionDto, UnmappedMidiNoteDto};
use crate::kit::note_to_piece;
use midly::{MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const DEFAULT_BPM: f64 = 120.0;
const DEFAULT_MICROS_PER_QUARTER: u32 = 500_000;
const MIN_BPM: f64 = 40.0;
const MAX_MIDI_DURATION_MS: f64 = 60.0 * 60.0 * 1000.0;
const MAX_MIDI_HITS: usize = 100_000;

#[derive(Clone, Copy, Debug)]
struct TempoPoint {
    tick: u64,
    micros_per_quarter: u32,
    ms_at_tick: f64,
}

#[derive(Debug)]
struct UnmappedAccumulator {
    note: u8,
    note_name: String,
    channel: u8,
    track_name: String,
    count: usize,
    first_time_ms: f64,
}

pub fn parse_midi_bytes(bytes: &[u8], label: &str) -> Result<SessionDto, String> {
    let smf =
        Smf::parse(bytes).map_err(|error| format!("Could not parse the MIDI file: {error}"))?;
    let ppq = match smf.header.timing {
        Timing::Metrical(ticks) => ticks.as_int(),
        Timing::Timecode(_, _) => {
            return Err("SMPTE timecode MIDI files are not supported yet.".to_string());
        }
    };

    let tempos = tempo_points(&smf, ppq);
    let bpm = tempos
        .first()
        .map(|tempo| micros_to_bpm(tempo.micros_per_quarter))
        .unwrap_or(DEFAULT_BPM);
    let mut hits = Vec::new();
    let mut tracks = Vec::new();
    let mut unmapped: HashMap<(usize, u8, u8), UnmappedAccumulator> = HashMap::new();
    let mut midi_duration_ms = 0.0;

    for (track_index, track) in smf.tracks.iter().enumerate() {
        let mut absolute_tick = 0_u64;
        let mut track_name = format!("Track {}", track_index + 1);
        let mut channel = 0_u8;
        let mut note_count = 0_usize;
        let mut mapped_count = 0_usize;
        let mut note_index = 0_usize;

        for event in track {
            absolute_tick += u64::from(event.delta.as_int());
            let time_ms = tick_to_ms(absolute_tick, ppq, &tempos);
            midi_duration_ms = f64::max(midi_duration_ms, time_ms);

            match event.kind {
                TrackEventKind::Meta(MetaMessage::TrackName(name))
                | TrackEventKind::Meta(MetaMessage::InstrumentName(name)) => {
                    if let Ok(name) = std::str::from_utf8(name) {
                        if !name.is_empty() {
                            track_name = name.to_string();
                        }
                    }
                }
                TrackEventKind::Midi {
                    channel: event_channel,
                    message,
                } => {
                    channel = event_channel.as_int();
                    if let MidiMessage::NoteOn { key, vel } = message {
                        let note = key.as_int();
                        let velocity = f64::from(vel.as_int()) / 127.0;
                        if velocity <= 0.0 {
                            continue;
                        }

                        note_count += 1;
                        if let Some(piece_id) = note_to_piece(note) {
                            mapped_count += 1;
                            hits.push(MidiHitDto {
                                id: format!("{track_index}-{absolute_tick}-{note}-{note_index}"),
                                tick: absolute_tick,
                                time_ms,
                                duration_ms: 20.0,
                                note,
                                note_name: note_name(note),
                                velocity,
                                channel,
                                piece_id,
                                track_index,
                                track_name: track_name.clone(),
                            });
                        } else {
                            let key = (track_index, channel, note);
                            if let Some(existing) = unmapped.get_mut(&key) {
                                existing.count += 1;
                            } else {
                                unmapped.insert(
                                    key,
                                    UnmappedAccumulator {
                                        note,
                                        note_name: note_name(note),
                                        channel,
                                        track_name: track_name.clone(),
                                        count: 1,
                                        first_time_ms: time_ms,
                                    },
                                );
                            }
                        }
                        note_index += 1;
                    }
                }
                _ => {}
            }
        }

        tracks.push(MidiTrackSummaryDto {
            index: track_index,
            name: track_name,
            channel,
            instrument: if channel == 9 {
                "Percussion".to_string()
            } else {
                "Unknown".to_string()
            },
            note_count,
            mapped_count,
        });
    }

    hits.sort_by(|a, b| {
        a.time_ms
            .partial_cmp(&b.time_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.note.cmp(&b.note))
    });
    if hits.len() > MAX_MIDI_HITS {
        return Err(format!(
            "MIDI file has too many notes ({}; max {}).",
            hits.len(),
            MAX_MIDI_HITS
        ));
    }
    let last_hit_time = hits.last().map(|hit| hit.time_ms).unwrap_or(0.0);
    let beat_tail_ms = if hits.is_empty() {
        0.0
    } else {
        beat_end_ms_after(last_hit_time, bpm)
    };
    let duration_ms = f64::max(1000.0, f64::max(midi_duration_ms, beat_tail_ms));
    if duration_ms > MAX_MIDI_DURATION_MS {
        return Err(format!(
            "MIDI track is longer than {} hour(s).",
            MAX_MIDI_DURATION_MS / 3_600_000.0
        ));
    }
    let mut unmapped_notes: Vec<_> = unmapped
        .into_values()
        .map(|note| UnmappedMidiNoteDto {
            note: note.note,
            note_name: note.note_name,
            channel: note.channel,
            track_name: note.track_name,
            count: note.count,
            first_time_ms: note.first_time_ms,
        })
        .collect();
    unmapped_notes.sort_by(|a, b| {
        a.first_time_ms
            .partial_cmp(&b.first_time_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(SessionDto {
        session_id: next_session_id(),
        label: label.to_string(),
        name: midi_name(&smf).unwrap_or_else(|| basename(label)),
        duration_ms,
        ppq,
        bpm,
        hits,
        unmapped_notes,
        tracks,
    })
}

fn tempo_points(smf: &Smf<'_>, ppq: u16) -> Vec<TempoPoint> {
    let mut raw = vec![(0_u64, DEFAULT_MICROS_PER_QUARTER)];
    for track in &smf.tracks {
        let mut absolute_tick = 0_u64;
        for event in track {
            absolute_tick += u64::from(event.delta.as_int());
            if let TrackEventKind::Meta(MetaMessage::Tempo(tempo)) = event.kind {
                raw.push((absolute_tick, tempo.as_int()));
            }
        }
    }

    raw.sort_by_key(|(tick, _)| *tick);
    let mut compressed: Vec<(u64, u32)> = Vec::with_capacity(raw.len());
    for (tick, tempo) in raw {
        if let Some((last_tick, last_tempo)) = compressed.last_mut() {
            if *last_tick == tick {
                *last_tempo = tempo;
                continue;
            }
        }
        compressed.push((tick, tempo));
    }

    let mut points = Vec::with_capacity(compressed.len());
    let mut current_ms = 0.0;
    let mut previous_tick = compressed[0].0;
    let mut previous_tempo = compressed[0].1;
    points.push(TempoPoint {
        tick: previous_tick,
        micros_per_quarter: previous_tempo,
        ms_at_tick: current_ms,
    });

    for (tick, tempo) in compressed.into_iter().skip(1) {
        current_ms += ticks_to_ms(tick - previous_tick, ppq, previous_tempo);
        points.push(TempoPoint {
            tick,
            micros_per_quarter: tempo,
            ms_at_tick: current_ms,
        });
        previous_tick = tick;
        previous_tempo = tempo;
    }

    points
}

fn tick_to_ms(tick: u64, ppq: u16, tempos: &[TempoPoint]) -> f64 {
    let tempo = tempos
        .iter()
        .rev()
        .find(|tempo| tempo.tick <= tick)
        .copied()
        .unwrap_or(TempoPoint {
            tick: 0,
            micros_per_quarter: DEFAULT_MICROS_PER_QUARTER,
            ms_at_tick: 0.0,
        });
    tempo.ms_at_tick + ticks_to_ms(tick - tempo.tick, ppq, tempo.micros_per_quarter)
}

fn ticks_to_ms(ticks: u64, ppq: u16, micros_per_quarter: u32) -> f64 {
    ticks as f64 * f64::from(micros_per_quarter) / 1000.0 / f64::from(ppq.max(1))
}

fn micros_to_bpm(micros_per_quarter: u32) -> f64 {
    60_000_000.0 / f64::from(micros_per_quarter.max(1))
}

fn beat_end_ms_after(position_ms: f64, bpm: f64) -> f64 {
    let normalized_bpm = if bpm.is_finite() {
        bpm.max(MIN_BPM)
    } else {
        DEFAULT_BPM
    };
    let beat_ms = 60_000.0 / normalized_bpm;
    ((position_ms.max(0.0) / beat_ms).floor() + 1.0) * beat_ms
}

fn midi_name(smf: &Smf<'_>) -> Option<String> {
    for track in &smf.tracks {
        for event in track {
            if let TrackEventKind::Meta(MetaMessage::TrackName(name)) = event.kind {
                if let Ok(name) = std::str::from_utf8(name) {
                    if !name.is_empty() {
                        return Some(name.to_string());
                    }
                }
            }
        }
    }
    None
}

fn basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

fn note_name(note: u8) -> String {
    const NAMES: [&str; 12] = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    let octave = i16::from(note) / 12 - 1;
    format!("{}{}", NAMES[usize::from(note % 12)], octave)
}

fn next_session_id() -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    format!("session-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn simple_midi(note: u8, tempo: Option<[u8; 3]>) -> Vec<u8> {
        let mut track = Vec::new();
        track.extend([0x00, 0xff, 0x03, 0x05]);
        track.extend(b"Drums");
        if let Some(tempo) = tempo {
            track.extend([0x00, 0xff, 0x51, 0x03]);
            track.extend(tempo);
        }
        track.extend([0x00, 0x99, note, 100]);
        track.extend([0x60, 0x89, note, 0]);
        track.extend([0x00, 0xff, 0x2f, 0x00]);

        let mut bytes = Vec::new();
        bytes.extend(b"MThd");
        bytes.extend([0x00, 0x00, 0x00, 0x06]);
        bytes.extend([0x00, 0x00]);
        bytes.extend([0x00, 0x01]);
        bytes.extend([0x01, 0xe0]);
        bytes.extend(b"MTrk");
        bytes.extend((track.len() as u32).to_be_bytes());
        bytes.extend(track);
        bytes
    }

    #[test]
    fn maps_notes_to_hits() {
        let parsed = parse_midi_bytes(&simple_midi(36, Some([0x0a, 0x2c, 0x2a])), "beat.mid")
            .expect("midi should parse");

        assert_eq!(parsed.name, "Drums");
        assert!((parsed.bpm - 90.0).abs() < 0.01);
        assert_eq!(parsed.hits.len(), 1);
        assert_eq!(parsed.hits[0].piece_id, crate::dto::PieceId::Kick);
        assert_eq!(parsed.tracks[0].mapped_count, 1);
    }

    #[test]
    fn reports_unmapped_notes() {
        let parsed =
            parse_midi_bytes(&simple_midi(12, None), "mixed.mid").expect("midi should parse");

        assert!(parsed.hits.is_empty());
        assert_eq!(parsed.unmapped_notes.len(), 1);
        assert_eq!(parsed.unmapped_notes[0].note, 12);
    }

    #[test]
    fn extends_duration_to_next_beat() {
        let parsed = parse_midi_bytes(&simple_midi(36, Some([0x16, 0xe3, 0x60])), "slow.mid")
            .expect("midi should parse");

        assert!((parsed.duration_ms - 1500.0).abs() < 0.01);
    }
}
