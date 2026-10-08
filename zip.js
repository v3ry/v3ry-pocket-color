(function (root) {
  "use strict";

  const MAX_ARCHIVE = 32 * 1024 * 1024;
  const MAX_ROM = 8 * 1024 * 1024;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    table[i] = crc >>> 0;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
  }
  function listROMs(bytes) {
    if (bytes.length > MAX_ARCHIVE) throw new Error("ZIP trop volumineux (maximum 32 Mio).");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fits = (offset, size) => offset >= 0 && offset + size <= bytes.length;
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
        end = i; break;
      }
    }
    if (end < 0) throw new Error("ZIP invalide ou tronque.");
    const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true);
    const start = view.getUint32(end + 16, true);
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)
      || view.getUint16(end + 8, true) !== count || count === 65535 || size === 0xffffffff || start === 0xffffffff) {
      throw new Error("Les ZIP multi-volumes et ZIP64 ne sont pas pris en charge.");
    }
    if (count > 4096 || !fits(start, size) || start + size !== end) {
      throw new Error("Repertoire ZIP invalide ou trop volumineux.");
    }
    const entries = [];
    let offset = start;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Repertoire ZIP tronque.");
      const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      const crc = view.getUint32(offset + 16, true), compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true), localOffset = view.getUint32(offset + 42, true);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > end || view.getUint16(offset + 34, true)) throw new Error("Entree ZIP invalide.");
      const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
      const name = new TextDecoder().decode(nameBytes);
      if (/\.(gb|gbc)$/i.test(name) && !name.startsWith("__MACOSX/")) {
        if (uncompressedSize > MAX_ROM || compressedSize > MAX_ARCHIVE || localOffset === 0xffffffff) {
          throw new Error("ROM ZIP trop volumineuse ou entree ZIP64 (maximum 8 Mio par ROM).");
        }
        entries.push({ name, nameBytes, flags, method, crc, compressedSize, uncompressedSize, localOffset });
      }
      offset = next;
    }
    if (offset !== end) throw new Error("Taille du repertoire ZIP incoherente.");
    if (!entries.length) throw new Error("Ce ZIP ne contient aucun fichier .GB ou .GBC.");
    return { bytes, entries, directoryOffset: start };
  }
  async function extractROM(archive, entry) {
    if (!archive.entries.includes(entry)) throw new Error("Entree ZIP inconnue.");
    if (entry.flags & 0x41) throw new Error("Les ZIP chiffres ne sont pas pris en charge.");
    if (![0, 8].includes(entry.method)) throw new Error(`Compression ZIP non prise en charge (${entry.method}).`);
    if (entry.uncompressedSize === 0) throw new Error("La ROM dans le ZIP est vide.");
    const bytes = archive.bytes, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offset = entry.localOffset;
    if (offset + 30 > archive.directoryOffset || view.getUint32(offset, true) !== 0x04034b50) {
      throw new Error("En-tete local ZIP invalide.");
    }
    const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength, end = start + entry.compressedSize;
    if (end > archive.directoryOffset || view.getUint16(offset + 6, true) !== entry.flags
      || view.getUint16(offset + 8, true) !== entry.method || nameLength !== entry.nameBytes.length
      || !entry.nameBytes.every((byte, i) => byte === bytes[offset + 30 + i])) {
      throw new Error("Metadonnees ZIP incoherentes.");
    }
    if (!(entry.flags & 8) && (view.getUint32(offset + 14, true) !== entry.crc
      || view.getUint32(offset + 18, true) !== entry.compressedSize
      || view.getUint32(offset + 22, true) !== entry.uncompressedSize)) {
      throw new Error("Tailles ou checksum ZIP incoherents.");
    }
    let result;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) throw new Error("Taille ZIP stockee invalide.");
      result = bytes.slice(start, end);
    } else {
      if (typeof DecompressionStream === "undefined") throw new Error("Ce navigateur ne sait pas decompresser les ZIP. Utilisez une version recente ou extrayez la ROM.");
      let decompressor;
      try { decompressor = new DecompressionStream("deflate-raw"); }
      catch (error) {
        throw new Error("La decompression ZIP deflate-raw est indisponible dans ce navigateur.", { cause: error });
      }
      const reader = new Blob([bytes.subarray(start, end)]).stream().pipeThrough(decompressor).getReader();
      result = new Uint8Array(entry.uncompressedSize);
      let written = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (written + value.length > result.length) throw new Error("La taille extraite depasse celle annoncee par le ZIP.");
          result.set(value, written); written += value.length;
        }
        if (written !== result.length) throw new Error("La ROM extraite est tronquee.");
      } catch (error) {
        await reader.cancel().catch((cancelError) => console.error("Annulation ZIP impossible", cancelError));
        throw new Error(`Decompression ZIP impossible : ${error.message}`, { cause: error });
      } finally { reader.releaseLock(); }
    }
    if (crc32(result) !== entry.crc) throw new Error("ROM ZIP corrompue : le CRC ne correspond pas.");
    return result;
  }
  const api = { listROMs, extractROM, crc32, MAX_ARCHIVE, MAX_ROM };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PocketZIP = api;
})(globalThis);
