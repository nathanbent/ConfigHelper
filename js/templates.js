/* P-touch Editor templates offered on the Labels tab, base64 so the page stays one self-contained file.
   The .lbx files live in templates/; test/parsers.test.js checks the two stay in step. */
(function (root) {
  'use strict';
  const NP = root.NP;
  NP.labelTemplates = {
    wrap: { file: 'cable-wrap-3line.lbx', label: 'Cable wrap, 3 lines, 24 mm tape',
      b64: 'UEsDBBQAAAAIAAAAIVz4izjEbwUAAKYeAAAJAAAAbGFiZWwueG1s7Vldc9o6EP0rGt/nYCB8JRPSAWI6zDiECXSSPApb2LqxJY8kN6S//q4kGwxN0jBtb9pMeIGVtNrV2XO8As4+rdMEfSVCUs76TqNWdxBhAQ8pi/rOl8X4qOd8Oj/L1GnIgzwlTCFwYPI0U30nVio7dV0ZxCTFsrYUXMVE1ChbcTdTPA9it1mvd91kuXZTTJlT+Er1mJDD3I1L6a/I+sDo2qP0DgV+OMxbe5TeNMXRgbkbl9J/iQWge+AOhdPmBFjhJZYHblJ6bVDEy0OrYFxK/+Bw/8D6V+jWdVBEGBFYcdF3ZkfGAXkhBRu1a61avdFDN5SF/EE6hodLHj6iIBcCuDiPCQEmmDfUcFBIBQmU2dpfXMN6Q5tTaeYZTsl2bTmX4YwIlJKQ4r4D5H+goYr7TqeXAWFiQqMYArS7tY62UywiynyygrFerbUdWvAMVlUXXVvPnVVDrhRPNwu5oHAGbPPNuFACUxjGueI+YZFOY4UTXbCUMx7EgqfkgsoswY99R4kcJjJBmRrxhIvNROGynZGTC3Myc1Iz0nf+GZtXMThh9zBUNy8HwT4UMgc4V1ykGD42O2AscXAfCZ6zcAGVJnZLHQT8L8yaznZkarAeWi6g2eLIa7frN45boh7kyqeMIEGiPMFilEOUusZkJQgx1natDvzZBEbrDaCPGxSLgrUbtWa1ZK2OXbgUuYzn9oEz/eL7xcgkNAfIJREzrCBjKMH0aurtDBWLggKzEqAttNM8XRJhsNJZ7oOrx2bfLa7rowGR+fJfIKs8PzOqsHKqTJicXzpxo/PkeQ/IAwmeXZqH0ehqdjfzpkA+FiW2tpgFsd5lcTXzvfECSpPQrADJpJkRhmQVWJPXbVFIY9wVxmsQtKCY4uxu+yr4abgFlqwzzEISIguk5eJIw4t8vCQJtDbwKFSR8ADI33SQIikISJFLIiKyAL3qJ4s/GHq+P5kv9ucfM1ISZmei3JWy+zlIO5flKj1iJyFJd7fKOxSwdTcfbZTRYOh7N9eDmRYkK47jE81Q9BkERoON7MYwXzwa3HLTSNBwxiXVjxlNJygIarRrJwWntAncOQbT3cnjQeDMBJzTbxCwYQqZM6quVpcEy1zoLDRl4MmZEmXq0LYcFCQjWBVFVXZLkiSyaiAchoJIeWvKVxh3xpBQvtvNp7uD5QVhoN2bW8LTempv9NSt6qld6+0pqvnrFNXs/pymbNIbVVnzD9DVAlDeV1P9jdVkyp8prYYJXEOKgYRHeqS4B+wJqOAABKMKJzTY9NGHgg1dDVEQYzHXJ9FwURXEAxaOcUoTTSaTi4mkVeOtFSKrFSSlc/bGY2+00PoJiYDk7SNWKkHvCc/thtLqrGmvBpGVXbNnSan3He0VTI99T0JTcfdpCOwuTAmeQPnNe98ZT269i/H14BJwDYCPY2EAKs6PZaZrrW8CSXnrkDFEvS8tc18Zbx2+chpO7C3ZDrmV6IOERgyBCOg3iI8TY+uvFaAYb7rwrs3tUNFgZwr0AoVh+spQGR0O5p4/ATpUA1iZl3tssmJ5kgwtO4sRU8sMB6SkGNlaAP+MUx3DliPg6RIWhCPwkZVj6a9FcKs+194Nw0Nj2mx0dVk0AUKbWHClg2eK88HOp9jp7iH2AoSNDwhfCaG72wZ/ugW42+69Y0Bfd3fusC+232bruf57Yi8llf57/NF/X9N/m++x/9rmUqqz9SN1tk5+iTp7f2v3Lazf0HzLqTfpv73Xtt/m/9p+3xU536L5vnMAq633xW7Yaj336077md+zPrrhD7rh8XvshnuX1b9cMB/t8He3w+O3/Db6l7PzD/gy+u4QrDZEt/rnh1v5i85O6T/47KfyL+fz/wBQSwMEFAAAAAgAAAAhXKsA0/d7AQAAfQMAAAgAAABwcm9wLnhtbIVT22rjMBD9leD3WHIK7a5JVGhp6VMJNMvCvinyJFZrXRiNu83fV7EcmfRCQQ+jc5mRdOzl9ZvpZq+AQTu7KqqSFzOwyjXa7lfFn839/FdxLZYGSNYenQckDWEWTTbUR3RVtES+ZiyoFowM5RYdtYCltjvHPLletWzB+RXrtm/s6ChGd6Oy1/fYlQ73rFEMOjBgKbCqrNikJUATvjQMDCvGQ0rvH6UBsZ4Po2d3jSaHS3ZGLhtVk6YuVmwqYxX67TMoSnDexFohyNhH3Dq70/sH6OJLDKITkaa/wOG/w0aM8/I2ChsICrWn+M6p/RkwyAmM7yTByT7tx/unadCIBV9cznkV14bzelj/jk3PVdlmYp47/aMvy9JxOhlojdp+P/CTLBlPfW4OH97rI5vkCK/6+PmJi1GRgcRDjHCjY2zVbz4qMpQUtjdruYcgqpHPQOb/xhyC4BOfgMzfthLP+AQkPoDqUdMh8xkYg0Npww7waQg0x/clOv1F4h1QSwECFAMUAAAACAAAACFc+Is4xG8FAACmHgAACQAAAAAAAAAAAAAAgAEAAAAAbGFiZWwueG1sUEsBAhQDFAAAAAgAAAAhXKsA0/d7AQAAfQMAAAgAAAAAAAAAAAAAAIABlgUAAHByb3AueG1sUEsFBgAAAAACAAIAbQAAADcHAAAAAA==' }
  };
  NP.b64Bytes = function (b64) {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  // One file in an uncompressed .zip. Brother's phone app (Pro Label Tool) only imports a .lbx that is zipped.
  NP.zipStore = function (name, bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    crc = ~crc >>> 0;
    const fn = [];
    for (let i = 0; i < name.length; i++) fn.push(name.charCodeAt(i) & 0x7f);
    const u16 = function (v) { return [v & 255, v >>> 8 & 255]; };
    const u32 = function (v) { return [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255]; };
    // version 2.0, no flags, stored, DOS time 00:00 and date 2026-01-01, crc, sizes, name length, no extra field
    const common = [].concat(u16(20), u16(0), u16(0), u16(0), u16((46 << 9) | (1 << 5) | 1), u32(crc), u32(bytes.length), u32(bytes.length), u16(fn.length), u16(0));
    const local = [0x50, 0x4b, 3, 4].concat(common, fn);
    const central = [0x50, 0x4b, 1, 2].concat(u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(0), fn);
    const end = [0x50, 0x4b, 5, 6].concat(u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length + bytes.length), u16(0));
    const out = new Uint8Array(local.length + bytes.length + central.length + end.length);
    out.set(local, 0); out.set(bytes, local.length); out.set(central, local.length + bytes.length); out.set(end, local.length + bytes.length + central.length);
    return out;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
