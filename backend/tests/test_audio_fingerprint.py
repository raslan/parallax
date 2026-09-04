from app.services.audio_fingerprint import (
    AUDIO_FINGERPRINT_SAMPLES,
    _downsample,
    audio_fingerprint_distance,
)


def test_downsample_shorter_than_target_returned_as_is():
    assert _downsample([1, 2, 3], 32) == [1, 2, 3]


def test_downsample_evenly_spaced():
    values = list(range(100))
    out = _downsample(values, 10)
    assert len(out) == 10
    # Evenly spaced picks, first and last close to the ends of the range.
    assert out[0] < 10
    assert out[-1] > 89


def test_downsample_respects_target_count():
    values = list(range(1000))
    assert len(_downsample(values, AUDIO_FINGERPRINT_SAMPLES)) == AUDIO_FINGERPRINT_SAMPLES


def test_distance_identical_is_zero():
    a = [0b1010, 0b0101]
    assert audio_fingerprint_distance(a, a) == 0


def test_distance_one_bit_off():
    a = [0b0000]
    b = [0b0001]
    assert audio_fingerprint_distance(a, b) == 1


def test_distance_empty_inputs_is_worst_case():
    assert audio_fingerprint_distance([], [1, 2]) == float("inf")
    assert audio_fingerprint_distance([1, 2], []) == float("inf")
