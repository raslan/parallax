def hamming_distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def cluster_by_phash(images: list[dict], threshold: int = 10) -> list[list[int]]:
    """
    Group image dicts (must have 'id' and 'phash' keys) into duplicate clusters.
    Only images with a non-None phash are considered.
    Returns list of clusters; singletons (no duplicates) are excluded.
    """
    valid = [img for img in images if img["phash"] is not None]
    n = len(valid)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        parent[find(x)] = find(y)

    for i in range(n):
        for j in range(i + 1, n):
            if hamming_distance(valid[i]["phash"], valid[j]["phash"]) <= threshold:
                union(i, j)

    groups: dict[int, list[int]] = {}
    for i, img in enumerate(valid):
        root = find(i)
        groups.setdefault(root, []).append(img["id"])

    return [ids for ids in groups.values() if len(ids) > 1]
