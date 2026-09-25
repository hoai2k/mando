import * as THREE from 'three';

/** Electric discharge stays at the two electrodes; the GLB is an unpowered shaft. */
export function addElectrostaffArcs(staff: THREE.Object3D): (time: number) => void {
  const fx = new THREE.Group();
  fx.name = 'electrostaffElectricity';
  staff.add(fx);
  const arcs: Array<{ line: THREE.Line; positions: THREE.BufferAttribute; end: number; phase: number }> = [];
  for (const end of [-1, 1]) {
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x9b42f5, transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    tip.position.y = end * 0.86;
    tip.name = end < 0 ? 'electrostaffTipLow' : 'electrostaffTipHigh';
    fx.add(tip);
    for (let n = 0; n < 4; n++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new THREE.BufferAttribute(new Float32Array(6 * 3), 3);
      geometry.setAttribute('position', positions);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: n === 0 ? 0xf3ccff : 0x9b42f5,
        transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      line.name = end < 0 ? 'electrostaffArcLow' : 'electrostaffArcHigh';
      fx.add(line);
      arcs.push({ line, positions, end, phase: n * 1.72 + (end + 1) * 2.13 });
    }
  }
  let lastStep = -1;
  return (time) => {
    const step = Math.floor(time * 22);
    if (step === lastStep) return;
    lastStep = step;
    for (const { line, positions, end, phase } of arcs) {
      const angle = phase + step * 0.41;
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const jitter = Math.sin(step * 11.7 + phase * 9.1 + i * 17.3);
        const radius = 0.047 + (i === 0 || i === 5 ? 0 : jitter * 0.027);
        positions.setXYZ(i, Math.cos(angle + t * 1.3) * radius,
          end * (0.66 + t * 0.25), Math.sin(angle + t * 1.3) * radius);
      }
      positions.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      (line.material as THREE.LineBasicMaterial).opacity = 0.42 + 0.45 * Math.abs(Math.sin(step * 0.67 + phase));
    }
  };
}
