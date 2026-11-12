from app.services.srt_io import Cue, format_timestamp, parse_srt, write_srt

SAMPLE = (
    "﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello there.\r\n\r\n"
    "2\r\n00:01:02,250 --> 00:01:04,000 X1:100\r\n<i>Two</i>\r\nlines\r\n\r\n"
    "3\r\n01:00:00,000 --> 01:00:01,999\r\n\r\n"
)


def test_parse_handles_bom_crlf_multiline_and_empty_cues():
    cues = parse_srt(SAMPLE)
    assert [c.text for c in cues] == ["Hello there.", "<i>Two</i>\nlines", ""]
    assert cues[0].start == 1.0 and cues[0].end == 2.5
    assert cues[1].start == 62.25
    assert cues[2].start == 3600.0 and cues[2].end == 3601.999


def test_parse_ignores_garbage_and_renumbers_on_write():
    text = "junk\n\n7\n00:00:01,000 --> 00:00:02,000\nA\n\nnot a cue\n\n"
    cues = parse_srt(text)
    assert len(cues) == 1
    out = write_srt(cues)
    assert out.startswith("1\n00:00:01,000 --> 00:00:02,000\nA\n")


def test_cues_without_blank_lines_between_them_are_still_separate():
    text = "1\n00:00:01,000 --> 00:00:02,000\nA\n2\n00:00:03,000 --> 00:00:04,000\nB\nB2\n"
    cues = parse_srt(text)
    assert [(c.start, c.text) for c in cues] == [(1.0, "A"), (3.0, "B\nB2")]


def test_roundtrip_keeps_times_and_text():
    cues = parse_srt(SAMPLE)
    again = parse_srt(write_srt(cues))
    assert [(c.start, c.end, c.text) for c in again] == [(c.start, c.end, c.text) for c in cues]


def test_timestamp_rounds_to_milliseconds():
    assert format_timestamp(3661.0015) == "01:01:01,002"
    assert format_timestamp(0) == "00:00:00,000"


def test_cue_is_a_value():
    assert Cue(1.0, 2.0, "x") == Cue(1.0, 2.0, "x")
