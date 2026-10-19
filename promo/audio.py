"""
Soundtrack for the Safeton film, synthesised from the render timeline (promo/out/timeline.json):
an ambient pad progression, a plucked arpeggio that builds with the story, and sound design for
clicks, keys, camera moves, the logo hit and the alarm. numpy only; writes promo/out/soundtrack.wav.
"""
import json
import sys
import wave
from pathlib import Path

import numpy as np

OUT = Path(__file__).parent / "out"
SR = 48000
tl = json.loads((OUT / "timeline.json").read_text())
DUR = tl["duration"] + 0.5
N = int(DUR * SR)
T = tl["scenes"]
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)
send = np.zeros((2, N))  # reverb send


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(sig, t0, gain=1.0, pan=0.0, rev=0.0):
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    sig = sig[: N - i0] if i0 >= 0 else sig[-i0:]
    i0 = max(i0, 0)
    gl = gain * np.cos((pan + 1) * np.pi / 4)
    gr = gain * np.sin((pan + 1) * np.pi / 4)
    L[i0 : i0 + len(sig)] += sig * gl
    R[i0 : i0 + len(sig)] += sig * gr
    if rev:
        send[0, i0 : i0 + len(sig)] += sig * gl * rev
        send[1, i0 : i0 + len(sig)] += sig * gr * rev


def band_noise(n, lo, hi, seed=None):
    g = np.random.default_rng(seed) if seed is not None else rng
    spec = np.fft.rfft(g.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    mask = np.clip((f - lo) / (lo * 0.5 + 1), 0, 1) * np.clip((hi - f) / (hi * 0.3 + 1), 0, 1)
    out = np.fft.irfft(spec * mask, n)
    return out / (np.abs(out).max() + 1e-9)


def lowpass(x, cutoff):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec /= np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(spec, len(x))


# ---- Harmony -----------------------------------------------------------------------------------
BPM = 92
BEAT = 60 / BPM
BAR = 4 * BEAT
CHORDS = [  # bass, pad voicing, arpeggio tones
    (45, [57, 60, 64, 67, 71], [69, 72, 76, 79, 83, 79, 76, 72]),  # Am9
    (41, [53, 57, 60, 64, 67], [65, 69, 72, 76, 79, 76, 72, 69]),  # Fmaj9
    (48, [52, 55, 59, 62, 64], [67, 71, 74, 76, 79, 76, 74, 71]),  # Cmaj9 (6)
    (43, [50, 55, 59, 62, 64], [62, 67, 71, 74, 76, 74, 71, 67]),  # G6/9
]
CHORD_LEN = 2 * BAR


def chord_at(t):
    return CHORDS[int(max(t, 0) // CHORD_LEN) % len(CHORDS)]


def pad_note(freq, dur, bright=6.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.0045, 0.0, 0.0052):
        ph = rng.uniform(0, 2 * np.pi)
        for k in range(1, 11):
            a = (1 / k) * np.exp(-k / bright)
            out += a * np.sin(2 * np.pi * freq * (1 + det) * k * t + ph * k)
    lfo = 1 + 0.12 * np.sin(2 * np.pi * 0.11 * t + rng.uniform(0, 6))
    return out * lfo / 3


def envelope(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.sin(np.linspace(0, np.pi / 2, na)) ** 2
    e[-nr:] *= np.cos(np.linspace(0, np.pi / 2, nr)) ** 2
    return e


def level(t):
    """Arrangement intensity 0..1 over the film."""
    if t < T["boot"]:
        return 0.0
    if t < T["setup"]:
        return 0.35
    if t < T["desktop"]:
        return 0.7
    if t < T["hero"]:
        return 1.0
    if t < T["end"]:
        return 0.8
    return 0.3


# Pad from the match cut to the end.
start_pad = T["boot"] - 1.5
t = start_pad
while t < DUR:
    bass, voicing, _ = chord_at(t - start_pad)
    dur = CHORD_LEN + 2.5
    for m in voicing:
        sig = pad_note(midi(m), dur) * envelope(int(dur * SR), 1.6, 2.4)
        add(sig, t, gain=0.028, pan=rng.uniform(-0.5, 0.5), rev=0.55)
    sub = np.sin(2 * np.pi * midi(bass - 12) * np.arange(int(dur * SR)) / SR)
    add(sub * envelope(len(sub), 1.0, 2.0), t, gain=0.05)
    t += CHORD_LEN

# Arpeggio (plucks) from the setup onwards, following the intensity.
def pluck(freq, dur=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, a in ((1, 1.0), (2, 0.35), (3, 0.18), (4, 0.08)):
        out += a * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (5 + 3 * k))
    atk = np.minimum(1, t / 0.004)
    return out * atk


step = BEAT / 2
t = T["setup"] + 0.0
i = 0
while t < T["end"] + 3.0:
    lv = level(t)
    if lv > 0:
        _, _, arp = chord_at(t - start_pad)
        m = arp[i % len(arp)]
        accent = 1.0 if i % 4 == 0 else 0.7
        add(pluck(midi(m)), t, gain=0.05 * lv * accent, pan=0.35 * np.sin(i * 0.9), rev=0.5)
        if lv >= 1.0 and i % 2 == 0:  # bass pulse in the desktop section
            b, _, _ = chord_at(t - start_pad)
            n = int(0.5 * SR)
            tt = np.arange(n) / SR
            add(np.sin(2 * np.pi * midi(b - 12) * tt) * np.exp(-tt * 6) * np.minimum(1, tt / 0.01), t, gain=0.09)
    t += step
    i += 1

# Final resolving chord on the end card.
for m in (45, 57, 64, 67, 71, 76):
    d = 7.0
    add(pad_note(midi(m), d, 8) * envelope(int(d * SR), 0.05, 4.5), T["end"] + 0.6, gain=0.03, rev=0.7)

# ---- Sound design -------------------------------------------------------------------------------
def click(freq=3100, g=1.0):
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * freq * t) * np.exp(-t * 320)
    s += band_noise(n, 2000, 9000) * np.exp(-t * 600) * 0.6
    return s * g


def whoosh(dur=1.1):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    out = np.zeros(n)
    for lo, hi, peak in ((150, 600, 0.45), (500, 1800, 0.5), (1500, 5000, 0.55), (4000, 11000, 0.6)):
        env = np.exp(-((t - peak) ** 2) / 0.03)
        out += band_noise(n, lo, hi) * env
    return out / np.abs(out).max()


def boom(soft=False):
    d = 3.2
    n = int(d * SR)
    t = np.arange(n) / SR
    f = 52 * np.exp(-t * 0.6) + 30
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.5)
    s += lowpass(rng.standard_normal(n), 400) * np.exp(-t * 6) * 0.08
    s *= np.minimum(1, t / 0.006)
    return s * (0.5 if soft else 1.0)


def riser(dur):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    out = np.zeros(n)
    for j, (lo, hi) in enumerate(((100, 400), (300, 1200), (900, 3500), (2500, 9000))):
        out += band_noise(n, lo, hi) * np.clip((t - j * 0.18) / 0.5, 0, 1) ** 2
    tone = np.sin(2 * np.pi * np.cumsum(110 + 330 * t**2) / SR) * 0.25
    return (out / np.abs(out).max() * 0.8 + tone) * t**2.2


def chime(freqs, d=1.6):
    n = int(d * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for k, a in ((1, 1), (2.76, 0.3), (5.4, 0.12)):
            out += a * np.sin(2 * np.pi * f * k * t) * np.exp(-t * (3 + k))
    return out * np.minimum(1, t / 0.003)


for ev in tl["events"]:
    k, t0 = ev["kind"], ev["t"]
    if k == "click":
        add(click(), t0, gain=0.11, pan=0.1, rev=0.08)
    elif k == "key":
        f = 1700 + rng.uniform(-250, 250)
        add(click(f), t0, gain=0.09 if ev.get("strong") else 0.045, pan=rng.uniform(-0.15, 0.15))
    elif k == "whoosh":
        add(whoosh(), t0 - 0.35, gain=0.16, pan=0.0, rev=0.3)
    elif k == "boom":
        add(boom(ev.get("soft", False)), t0, gain=0.4, rev=0.35)
        add(chime([midi(69), midi(76), midi(81)], 3.0), t0, gain=0.05, rev=0.8)
    elif k == "rise":
        d = ev.get("dur", 5.0)
        add(riser(d), t0, gain=0.12, rev=0.4)
    elif k == "snap":
        n = int(0.06 * SR)
        tt = np.arange(n) / SR
        s = np.sin(2 * np.pi * 660 * tt) * np.exp(-tt * 70)
        add(s, t0, gain=0.07, rev=0.2)
        add(s * 0.8, t0 + 0.05, gain=0.06, rev=0.2)
    elif k == "alert":
        add(chime([midi(76)]), t0, gain=0.09, pan=0.3, rev=0.6)
        add(chime([midi(72)]), t0 + 0.18, gain=0.08, pan=0.3, rev=0.6)

# ---- Reverb (synthetic hall, FFT convolution) ---------------------------------------------------
def reverb(x, seed):
    d = 3.2
    n = int(d * SR)
    t = np.arange(n) / SR
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-t * 2.2)
    ir = lowpass(ir, 6500)
    ir[: int(0.02 * SR)] = 0
    m = len(x) + n
    size = 1 << (m - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return y / np.abs(ir).sum() * 40


L += reverb(send[0], 1) * 0.5
R += reverb(send[1], 2) * 0.5

# ---- Master ---------------------------------------------------------------------------------------
mix = np.stack([L, R])
mix -= mix.mean(axis=1, keepdims=True)
peak = np.abs(mix).max()
mix = mix / peak * 1.25
mix = np.tanh(mix) / np.tanh(1.25)
mix *= 10 ** (-1.5 / 20)
fade = int(1.2 * SR)
mix[:, -fade:] *= np.linspace(1, 0, fade)
pcm = (mix.T * 32767).astype(np.int16)
with wave.open(str(OUT / "soundtrack.wav"), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("soundtrack", DUR, "s", file=sys.stderr)
