// Minimal signature pad: draw with finger, pen or mouse; export a trimmed PNG.
(function () {
  function SignaturePad(wrap) {
    const canvas = wrap.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let empty = true;
    let last = null;

    function resize() {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const rect = canvas.getBoundingClientRect();
      const data = empty ? null : canvas.toDataURL();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#000';
      if (data) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
        img.src = data;
      }
    }

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      empty = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      const mid = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
      ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
    canvas.style.touchAction = 'none';

    const clearBtn = wrap.querySelector('.clear');
    if (clearBtn) clearBtn.addEventListener('click', () => this.clear());

    this.clear = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      empty = true;
    };
    this.isEmpty = () => empty;
    // PNG cropped to the ink, with a little padding.
    this.toDataURL = () => {
      const { width: w, height: h } = canvas;
      const px = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (px[(y * w + x) * 4 + 3] > 10) {
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < x0) return canvas.toDataURL('image/png');
      const pad = 8;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
      const out = document.createElement('canvas');
      out.width = x1 - x0; out.height = y1 - y0;
      out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
      return out.toDataURL('image/png');
    };

    window.addEventListener('resize', resize);
    resize();
  }
  window.SignaturePad = SignaturePad;
})();
