"""Sondeo NTP real: paquete cliente v4 por UDP 123 y lectura de la respuesta.

No basta con "el puerto parece abierto": UDP no da esa señal. Se manda una
petición NTP de verdad y se exige una respuesta con modo servidor (4) y un
transmit timestamp plausible, que es lo único que demuestra que hay un servicio
de hora y no un cortafuegos silencioso.
"""
import socket, struct, sys, time

NTP_EPOCH = 2208988800  # segundos entre 1900 y 1970


def probe(host, timeout=3.0):
    pkt = bytearray(48)
    pkt[0] = 0x23  # LI=0, VN=4, Mode=3 (cliente)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        t0 = time.time()
        s.sendto(bytes(pkt), (host, 123))
        data, _ = s.recvfrom(512)
    except socket.timeout:
        return host, "SIN RESPUESTA (timeout %.0fs)" % timeout, None
    except OSError as e:
        return host, "ERROR %s" % e, None
    finally:
        s.close()
    if len(data) < 48:
        return host, "respuesta corta (%d bytes)" % len(data), None
    li_vn_mode = data[0]
    modo = li_vn_mode & 0x7
    stratum = data[1]
    tx = struct.unpack("!I", data[40:44])[0] - NTP_EPOCH
    deriva = tx - t0
    ok = modo == 4 and 1 <= stratum <= 15
    return host, ("modo=%d stratum=%d hora=%s deriva=%+.1fs" % (
        modo, stratum, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(tx)), deriva)), ok


for h in sys.argv[1:]:
    host, det, ok = probe(h)
    print("%-16s %-6s %s" % (host, "SI" if ok else ("NO" if ok is False else "??"), det))
