import cbor2, zlib

START = b"\xC0"  # SLIP-like sentinel

def encode_frame(obj: dict) -> bytes:
    payload = cbor2.dumps(obj)
    crc = zlib.crc32(payload) & 0xFFFFFFFF
    body = payload + crc.to_bytes(4, "big")
    return START + body + START

def decode_frames(buf: bytes):
    # naive splitter for demo
    parts = buf.split(START)
    for i in range(1, len(parts)-1):
        body = parts[i]
        payload, crc = body[:-4], int.from_bytes(body[-4:], "big")
        if zlib.crc32(payload) & 0xFFFFFFFF == crc:
            yield cbor2.loads(payload)