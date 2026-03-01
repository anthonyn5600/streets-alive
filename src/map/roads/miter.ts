export function computeMiterNormals(pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  const normals: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < pts.length; i++) {
    let nx = 0, nz = 0;

    if (i === 0) {
      const dx = pts[1].x - pts[0].x;
      const dz = pts[1].z - pts[0].z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0) { nx = -dz / len; nz = dx / len; }
    } else if (i === pts.length - 1) {
      const dx = pts[i].x - pts[i - 1].x;
      const dz = pts[i].z - pts[i - 1].z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0) { nx = -dz / len; nz = dx / len; }
    } else {
      const dx1 = pts[i].x - pts[i - 1].x;
      const dz1 = pts[i].z - pts[i - 1].z;
      const len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1);
      const dx2 = pts[i + 1].x - pts[i].x;
      const dz2 = pts[i + 1].z - pts[i].z;
      const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);

      if (len1 > 0 && len2 > 0) {
        const n1x = -dz1 / len1, n1z = dx1 / len1;
        const n2x = -dz2 / len2, n2z = dx2 / len2;
        nx = (n1x + n2x) / 2;
        nz = (n1z + n2z) / 2;
        const miterLen = Math.sqrt(nx * nx + nz * nz);
        if (miterLen > 0.001) {
          const scale = Math.min(1 / miterLen, 2);
          nx *= scale;
          nz *= scale;
        }
      } else if (len1 > 0) {
        nx = -dz1 / len1; nz = dx1 / len1;
      } else if (len2 > 0) {
        nx = -dz2 / len2; nz = dx2 / len2;
      }
    }

    normals.push({ x: nx, z: nz });
  }
  return normals;
}
