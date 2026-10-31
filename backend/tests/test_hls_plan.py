from app.services.hls_plan import CHUNK_SEGMENTS, chunk_start, media_playlist, plan_segments


def _cuts(plan):
    return [round(s.start, 3) for s in plan]


def test_regular_gop_cuts_on_every_target():
    keyframes = [float(t) for t in range(0, 61, 2)]
    plan = plan_segments(keyframes, 61.0, chunk=100)
    assert _cuts(plan) == [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60]
    assert abs(sum(s.duration for s in plan) - 61.0) < 1e-6


def test_cut_is_first_keyframe_at_or_after_target():
    plan = plan_segments([0.0, 5.5, 9.5, 16.5, 28.5, 31.0], 40.0, chunk=100)
    # targets 6, 12, 18, 24, 30 -> 9.5, 16.5, 28.5, then 31.0 (must come after the last cut)
    assert _cuts(plan) == [0, 9.5, 16.5, 28.5, 31.0]


def test_chunks_are_anchored_at_their_own_first_cut():
    keyframes = [0.0, 3.5, 7.0, 10.5, 14.0, 17.5, 21.0, 24.5, 28.0, 31.5, 35.0]
    # chunk=2: first chunk cuts at targets 6, 12 -> 7.0, 14.0; the next chunk re-anchors at 14.0
    # so its targets are 20, 26 -> 21.0, 28.0
    plan = plan_segments(keyframes, 36.0, chunk=2)
    assert _cuts(plan)[:5] == [0, 7.0, 14.0, 21.0, 28.0]


def test_run_restarted_at_a_chunk_start_cuts_like_the_plan():
    keyframes = [0.0, 2.5, 4.0, 9.5, 12.0, 15.0, 21.0, 22.0, 29.0, 31.0, 40.0, 41.0, 50.0]
    full = plan_segments(keyframes, 55.0, chunk=3)
    start = 3  # second chunk
    tail = [k for k in keyframes if k >= full[start].start]
    again = plan_segments(tail, 55.0, chunk=3)
    # (a plan's first segment is always labelled as starting at 0, so compare the cuts after it)
    assert _cuts(again)[1:3] == _cuts(full)[start + 1 : start + 3]


def test_empty_or_unknown_inputs():
    assert plan_segments([], 100.0) == []
    assert plan_segments([0.0], 0.0) == []


def test_single_keyframe_is_one_segment():
    plan = plan_segments([0.0], 10.0)
    assert [(s.start, s.duration) for s in plan] == [(0.0, 10.0)]


def test_chunk_start():
    assert chunk_start(0) == 0
    assert chunk_start(CHUNK_SEGMENTS - 1) == 0
    assert chunk_start(CHUNK_SEGMENTS) == CHUNK_SEGMENTS
    assert chunk_start(CHUNK_SEGMENTS * 3 + 4) == CHUNK_SEGMENTS * 3


def test_media_playlist_is_a_complete_vod_fmp4_playlist():
    plan = plan_segments([0.0, 7.0, 14.5], 20.0, chunk=100)
    text = media_playlist(plan, "init.mp4", "seg_{:05d}.m4s")
    lines = text.splitlines()
    assert lines[0] == "#EXTM3U"
    assert "#EXT-X-PLAYLIST-TYPE:VOD" in lines
    assert '#EXT-X-MAP:URI="init.mp4"' in lines
    assert "#EXT-X-TARGETDURATION:8" in lines  # longest segment is 7.5 s
    assert lines[-1] == "#EXT-X-ENDLIST"
    assert [ln for ln in lines if ln.startswith("seg_")] == [
        "seg_00000.m4s",
        "seg_00001.m4s",
        "seg_00002.m4s",
    ]
    assert "#EXTINF:7.000000," in lines
