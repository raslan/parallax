"""The two server-side Shared audio dials are validated at the boundary of both endpoints.

Validation runs before the handler, so a library that does not exist is enough: a body the
endpoint accepts then gets a 404 for the missing library, and one it rejects gets a 422.
Each endpoint is one test that loops over its cases, because starting the app is slow."""

import pytest

ENDPOINTS = [
    "/api/libraries/999999/find-duplicates",
    "/api/audio-libraries/999999/find-duplicates",
]

ACCEPTED = [
    {"audio_similarity": 0.65},  # the lowest "Sounds alike" allowed (65%)
    {"audio_similarity": 0.95},
    {"audio_min_stretch": 0},
    {"audio_min_stretch": 3600},
    {},  # a client that sends none of them gets the defaults
]

REJECTED = [
    {"audio_similarity": 0.64},  # unrelated music starts matching below ~65%
    {"audio_similarity": 0.5},
    {"audio_similarity": 0.96},
    {"audio_min_stretch": -1},
    {"audio_min_stretch": 3601},
]


@pytest.mark.parametrize("url", ENDPOINTS)
def test_the_range_of_each_dial_is_enforced(client, url):
    for body in ACCEPTED:
        assert client.post(url, json=body).status_code == 404, body
    for body in REJECTED:
        assert client.post(url, json=body).status_code == 422, body
