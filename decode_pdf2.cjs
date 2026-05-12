// Comprehensive PDF text decoder for Hamilton T1 manual
const fs = require('fs');
const zlib = require('zlib');
const buf = fs.readFileSync('HAMILTON-T1_ops-manual_v3.0.x_en_usa_10103179.03.pdf');
const rawStr = buf.toString('binary');

// Step 1: Extract all ToUnicode maps
function extractAllMaps() {
  const maps = [];
  let pos = 0;
  while (pos < rawStr.length - 4) {
    if (rawStr[pos]==='s' && rawStr.slice(pos,pos+6)==='stream') {
      const nl = rawStr.indexOf('\n', pos+6);
      if (nl<0) { pos++; continue; }
      const start = nl+1;
      const end = rawStr.indexOf('endstream', start);
      if (end<0 || end-start>500000) { pos++; continue; }
      const chunk = buf.slice(start, end);
      try {
        const dec = zlib.inflateSync(chunk).toString('latin1');
        if (dec.includes('beginbfchar')) {
          const map = {};
          const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
          let m;
          while ((m = re.exec(dec)) !== null) {
            const glyphId = m[1].padStart(4,'0').toUpperCase();
            const cpHex = m[2];
            // Handle surrogate pairs for emoji, etc. - skip those
            if (cpHex.length <= 4) {
              const cp = parseInt(cpHex, 16);
              if (cp) map[glyphId] = String.fromCharCode(cp);
            }
          }
          if (Object.keys(map).length > 0) maps.push(map);
        }
      } catch(e) {}
      pos = end + 9;
    } else { pos++; }
  }
  return maps;
}

// Step 2: Extract all text streams with font tracking
function extractText(allMaps) {
  const pages = [];
  let pos = 0;
  
  while (pos < rawStr.length - 4) {
    if (rawStr[pos]==='s' && rawStr.slice(pos,pos+6)==='stream') {
      const nl = rawStr.indexOf('\n', pos+6);
      if (nl<0) { pos++; continue; }
      const start = nl+1;
      const end = rawStr.indexOf('endstream', start);
      if (end<0 || end-start>500000) { pos++; continue; }
      const chunk = buf.slice(start, end);
      try {
        const dec = zlib.inflateSync(chunk).toString('latin1');
        
        if (dec.includes('BT') && (dec.includes('TJ') || dec.includes('Tj'))) {
          // Parse content stream with font tracking
          const pageText = [];
          let currentMapIdx = 0; // default to first map
          
          // Find all font selections and text
          // Split by BT/ET blocks
          const btRe = /BT([\s\S]*?)ET/g;
          let btM;
          while ((btM = btRe.exec(dec)) !== null) {
            const block = btM[1];
            let lineText = '';
            
            // Process tokens in order
            const tokenRe = /\/Font(\d+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*(?:TJ|Tj)|\[([^\]]+)\]\s*TJ/g;
            let tokM;
            while ((tokM = tokenRe.exec(block)) !== null) {
              if (tokM[1] !== undefined) {
                // Font selection: /Font1 Tf -> use map index (fontN-1)
                currentMapIdx = (parseInt(tokM[1]) - 1);
                if (currentMapIdx < 0 || currentMapIdx >= allMaps.length) currentMapIdx = 0;
              } else if (tokM[2] !== undefined) {
                // Direct hex string
                const map = allMaps[currentMapIdx] || allMaps[0];
                lineText += decodeHex(tokM[2], map);
              } else if (tokM[3] !== undefined) {
                // Array TJ: [<hex> -kern <hex> ...]
                const map = allMaps[currentMapIdx] || allMaps[0];
                const arrHex = /<([0-9A-Fa-f]+)>/g;
                let aM;
                while ((aM = arrHex.exec(tokM[3])) !== null) {
                  lineText += decodeHex(aM[1], map);
                }
              }
            }
            if (lineText.trim()) pageText.push(lineText.trim());
          }
          if (pageText.length > 0) pages.push(pageText.join('\n'));
        }
      } catch(e) {}
      pos = end + 9;
    } else { pos++; }
  }
  return pages;
}

function decodeHex(hex, map) {
  let result = '';
  for (let i = 0; i < hex.length; i += 4) {
    const code = hex.slice(i, i+4).toUpperCase();
    result += map[code] || '';
  }
  return result;
}

console.log('Extracting maps...');
const allMaps = extractAllMaps();
console.log('Found', allMaps.length, 'ToUnicode maps');

console.log('Extracting text...');
const pages = extractText(allMaps);
console.log('Found', pages.length, 'text blocks');

const out = pages.join('\n---\n');
fs.writeFileSync('manual_full.txt', out, 'utf8');
console.log('Total chars:', out.length);
// Show first 5000 chars
console.log(out.slice(0, 5000));
