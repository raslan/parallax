from app.services.image_duplicates import hamming_distance, cluster_by_phash

def test_hamming_distance_identical():
    assert hamming_distance(0b1010, 0b1010) == 0

def test_hamming_distance_one_bit():
    assert hamming_distance(0b1010, 0b1011) == 1

def test_cluster_by_phash_groups_similar():
    images = [
        {"id": 1, "phash": 0b0000},
        {"id": 2, "phash": 0b0001},  # 1 bit diff from id=1 → cluster A
        {"id": 3, "phash": 0b1111_0000},  # far from 1 and 2
        {"id": 4, "phash": 0b1111_0001},  # 1 bit diff from id=3 → cluster B
    ]
    clusters = cluster_by_phash(images, threshold=2)
    assert len(clusters) == 2
    cluster_ids = [sorted(c) for c in clusters]
    assert [1, 2] in cluster_ids
    assert [3, 4] in cluster_ids

def test_cluster_by_phash_excludes_none():
    images = [
        {"id": 1, "phash": None},
        {"id": 2, "phash": 0b0000},
    ]
    clusters = cluster_by_phash(images, threshold=10)
    assert clusters == []
