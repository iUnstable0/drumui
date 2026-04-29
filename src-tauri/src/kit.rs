use crate::dto::{KitDto, KitPieceDto, PieceId};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::OnceLock;

const KIT_JSON: &str = include_str!("../../src/kit/analog808.json");

const SAMPLE_BYTES: &[(PieceId, &[u8])] = &[
    (
        PieceId::Kick,
        include_bytes!("../../public/kits/analog-808/samples/kick.wav"),
    ),
    (
        PieceId::Snare,
        include_bytes!("../../public/kits/analog-808/samples/snare.wav"),
    ),
    (
        PieceId::Clap,
        include_bytes!("../../public/kits/analog-808/samples/clap.wav"),
    ),
    (
        PieceId::ClosedHat,
        include_bytes!("../../public/kits/analog-808/samples/closed-hat.wav"),
    ),
    (
        PieceId::OpenHat,
        include_bytes!("../../public/kits/analog-808/samples/open-hat.wav"),
    ),
    (
        PieceId::LowTom,
        include_bytes!("../../public/kits/analog-808/samples/low-tom.wav"),
    ),
    (
        PieceId::MidTom,
        include_bytes!("../../public/kits/analog-808/samples/mid-tom.wav"),
    ),
    (
        PieceId::Crash,
        include_bytes!("../../public/kits/analog-808/samples/crash.wav"),
    ),
    (
        PieceId::Ride,
        include_bytes!("../../public/kits/analog-808/samples/ride.wav"),
    ),
];

#[derive(Clone, Debug)]
pub struct Sample {
    pub left: Vec<f32>,
    pub right: Vec<f32>,
}

impl Sample {
    pub fn len(&self) -> usize {
        self.left.len().min(self.right.len())
    }
}

#[derive(Clone, Debug)]
pub struct SampleBank {
    samples: [Sample; crate::dto::PIECE_COUNT],
}

impl SampleBank {
    pub fn load(output_sample_rate: u32) -> Result<Self, String> {
        let mut samples = Vec::with_capacity(crate::dto::PIECE_COUNT);
        for piece_id in PieceId::ALL {
            let bytes = SAMPLE_BYTES
                .iter()
                .find_map(|(candidate, bytes)| (*candidate == piece_id).then_some(*bytes))
                .ok_or_else(|| format!("Missing sample bytes for {piece_id:?}."))?;
            samples.push(decode_wav(bytes, output_sample_rate)?);
        }

        let samples = samples
            .try_into()
            .map_err(|_| "Sample bank did not contain every kit piece.".to_string())?;
        Ok(Self { samples })
    }

    pub fn get(&self, piece_id: PieceId) -> &Sample {
        &self.samples[piece_id.index()]
    }
}

pub fn kit() -> &'static KitDto {
    static KIT: OnceLock<KitDto> = OnceLock::new();
    KIT.get_or_init(|| serde_json::from_str(KIT_JSON).expect("analog808.json must be valid"))
}

pub fn piece(piece_id: PieceId) -> &'static KitPieceDto {
    // Each PieceId variant has a corresponding entry in the embedded analog808.json
    // (verified by the loads_all_samples test). A missing entry would mean the
    // bundled kit JSON is malformed and the binary should fail loudly.
    #[allow(clippy::panic)]
    kit()
        .pieces
        .iter()
        .find(|piece| piece.id == piece_id)
        .unwrap_or_else(|| panic!("missing kit metadata for {piece_id:?}"))
}

pub fn note_to_piece(note: u8) -> Option<PieceId> {
    static NOTES: OnceLock<HashMap<u8, PieceId>> = OnceLock::new();
    NOTES
        .get_or_init(|| {
            let mut notes = HashMap::new();
            for piece in &kit().pieces {
                for note in &piece.midi_notes {
                    notes.insert(*note, piece.id);
                }
            }
            notes
        })
        .get(&note)
        .copied()
}

pub fn is_lane_audible(
    piece_id: PieceId,
    states: &[crate::dto::LaneStateDto; crate::dto::PIECE_COUNT],
) -> bool {
    let solo_active = PieceId::ALL
        .iter()
        .any(|candidate| states[candidate.index()].soloed);
    let lane = states[piece_id.index()];
    !lane.muted && lane.volume > 0.001 && (!solo_active || lane.soloed)
}

pub fn choke_targets(piece_id: PieceId) -> &'static [PieceId] {
    match piece_id {
        PieceId::ClosedHat => &[PieceId::OpenHat],
        _ => &[],
    }
}

fn decode_wav(bytes: &[u8], output_sample_rate: u32) -> Result<Sample, String> {
    let mut reader = hound::WavReader::new(Cursor::new(bytes))
        .map_err(|error| format!("invalid sample wav: {error}"))?;
    let spec = reader.spec();
    let channels = usize::from(spec.channels.max(1));
    let mut interleaved = Vec::new();

    match spec.sample_format {
        hound::SampleFormat::Float => {
            for sample in reader.samples::<f32>() {
                interleaved.push(sample.map_err(|error| format!("invalid float sample: {error}"))?);
            }
        }
        hound::SampleFormat::Int if spec.bits_per_sample <= 16 => {
            let max = i16::MAX as f32;
            for sample in reader.samples::<i16>() {
                interleaved.push(
                    sample.map_err(|error| format!("invalid int sample: {error}"))? as f32 / max,
                );
            }
        }
        hound::SampleFormat::Int => {
            let max = ((1_i64 << (spec.bits_per_sample - 1)) - 1) as f32;
            for sample in reader.samples::<i32>() {
                interleaved.push(
                    sample.map_err(|error| format!("invalid int sample: {error}"))? as f32 / max,
                );
            }
        }
    }

    let frame_count = interleaved.len() / channels;
    let mut left = Vec::with_capacity(frame_count);
    let mut right = Vec::with_capacity(frame_count);
    for frame in 0..frame_count {
        let base = frame * channels;
        let l = interleaved[base];
        let r = if channels > 1 {
            interleaved[base + 1]
        } else {
            l
        };
        left.push(l);
        right.push(r);
    }

    if spec.sample_rate == output_sample_rate {
        return Ok(Sample { left, right });
    }

    Ok(resample_linear(
        Sample { left, right },
        spec.sample_rate,
        output_sample_rate,
    ))
}

fn resample_linear(sample: Sample, source_rate: u32, target_rate: u32) -> Sample {
    let source_len = sample.len();
    if source_len == 0 || source_rate == 0 || target_rate == 0 {
        return sample;
    }

    let target_len = ((source_len as f64) * f64::from(target_rate) / f64::from(source_rate))
        .ceil()
        .max(1.0) as usize;
    let scale = f64::from(source_rate) / f64::from(target_rate);
    let mut left = Vec::with_capacity(target_len);
    let mut right = Vec::with_capacity(target_len);

    for target_index in 0..target_len {
        let source_pos = target_index as f64 * scale;
        let i0 = source_pos.floor() as usize;
        let i1 = (i0 + 1).min(source_len - 1);
        let frac = (source_pos - i0 as f64) as f32;
        left.push(lerp(sample.left[i0], sample.left[i1], frac));
        right.push(lerp(sample.right[i0], sample.right[i1], frac));
    }

    Sample { left, right }
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_midi_notes_to_kit_pieces() {
        assert_eq!(note_to_piece(36), Some(PieceId::Kick));
        assert_eq!(note_to_piece(42), Some(PieceId::ClosedHat));
        assert_eq!(note_to_piece(12), None);
    }

    #[test]
    fn loads_all_samples() {
        let bank = SampleBank::load(44_100).expect("samples should decode");
        for piece_id in PieceId::ALL {
            assert!(bank.get(piece_id).len() > 0);
        }
    }
}
