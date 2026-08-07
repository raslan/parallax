def test_guess_file_episodes_standard_naming():
    from app.services.renamer import guess_file_episodes

    files = [
        "/media/The Wire/The.Wire.S02E01.720p.WEB-DL.x264-GROUP.mp4",
        "/media/The Wire/The.Wire.S02E02.1080p.WEB-DL.x264-YIFY.mp4",
    ]
    result = guess_file_episodes(files)

    assert len(result) == 2
    assert result[0] == {"file_path": files[0], "season": 2, "episode": 1}
    assert result[1] == {"file_path": files[1], "season": 2, "episode": 2}


def test_guess_file_episodes_unparseable_filename_returns_none():
    from app.services.renamer import guess_file_episodes

    files = ["/media/random-download-8f3a91.mp4"]
    result = guess_file_episodes(files)

    assert result == [{"file_path": files[0], "season": None, "episode": None}]


def test_guess_file_episodes_multi_episode_release_takes_first():
    from app.services.renamer import guess_file_episodes

    # guessit returns a list for "S01E01E02"-style multi-episode releases —
    # this must not raise, and must resolve to a single int.
    files = ["/media/Show.Name.S01E01E02.720p.mp4"]
    result = guess_file_episodes(files)

    assert result[0]["season"] == 1
    assert result[0]["episode"] == 1


def test_guess_file_episodes_preserves_order_and_length():
    from app.services.renamer import guess_file_episodes

    files = [f"/media/Show.S03E{n:02d}.mp4" for n in range(1, 6)]
    result = guess_file_episodes(files)

    assert [r["file_path"] for r in result] == files
    assert [r["episode"] for r in result] == [1, 2, 3, 4, 5]


def test_list_files_route_includes_file_guesses(tmp_path, client):
    show_dir = tmp_path / "The Wire"
    show_dir.mkdir()
    (show_dir / "The.Wire.S02E01.720p.WEB-DL.x264-GROUP.mp4").touch()
    (show_dir / "The.Wire.S02E02.1080p.WEB-DL.x264-YIFY.mp4").touch()

    resp = client.get("/api/identify/files", params={"path": str(show_dir)})

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["files"]) == 2
    assert data["guess"]["type"] == "tv"
    assert len(data["file_guesses"]) == len(data["files"])
    seasons = {g["season"] for g in data["file_guesses"]}
    episode_numbers = {g["episode"] for g in data["file_guesses"]}
    assert seasons == {2}
    assert episode_numbers == {1, 2}
    # file_guesses is parallel to files, same order
    assert [g["file_path"] for g in data["file_guesses"]] == data["files"]
