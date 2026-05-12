const fs = require('fs');
const zlib = require('zlib');
const buf = fs.readFileSync('HAMILTON-T1_ops-manual_v3.0.x_en_usa_10103179.03.pdf');

const uniMap = {
  '0001':'O','0002':'p','0003':'e','0004':'r','0005':'a','0006':'t','0007':'o',
  '0008':"'",'0009':'s','000A':' ','000B':'M','000C':'n','000D':'u','000E':'l',
  '000F':'(','0010':'h','0011':'i','0012':'g','0013':'d','0014':')','0015':'P',
  '0016':'x','0017':'m','0018':'y','0019':'I','001A':'c','001B':'f','001C':'U',
  '001D':'V','001E':'C','001F':'G','0020':'H','0021':'A','0022':'L','0023':'T',
  '0024':'N','0025':'-','0026':'9','0027':'0','0028':'S','0029':'v','002A':'B',
  '002B':'E','002C':'D','002D':'w','002E':':','002F':'b','0030':',','0031':'.',
  '0032':'F','0033':'j','0034':'k','0035':'\u2013','0036':'1','0037':'5','0038':' ',
  '0039':'/','003A':'q','003B':"'",'003C':'2','003D':'%','003E':'W','003F':'4',
  '0040':'\u00B0','0041':'6','0042':'z','0043':'R','0044':'8','0045':'3','0046':'Y',
  '0047':'<','0048':'*','0049':'&','004A':'>','004B':'+','004C':'!','004D':';','004E':'J'
};

function decodeHexStr(hex) {
  let result = '';
  for (let i = 0; i < hex.length; i += 4) {
    const code = hex.slice(i, i+4).toUpperCase();
    result += uniMap[code] || '';
  }
  return result;
}

// We also need other ToUnicode maps for other fonts (numbers, headers, etc.)
// Collect all ToUnicode maps
const allMaps = [uniMap];
const rawStr = buf.toString('binary');
const textLines = [];
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
      
      // Extra: collect additional ToUnicode maps
      if (dec.includes('beginbfchar')) {
        const map = {};
        const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        let m2;
        while ((m2 = re.exec(dec)) !== null) {
          const glyphId = m2[1].padStart(4,'0').toUpperCase();
          const unicode = parseInt(m2[2], 16);
          if (unicode) map[glyphId] = String.fromCharCode(unicode);
        }
        if (Object.keys(map).length > 0) allMaps.push(map);
      }
      
      if (dec.includes('BT') && (dec.includes('TJ') || dec.includes('Tj'))) {
        const tjRe = /<([0-9A-Fa-f]+)>/g;
        const decoded = [];
        let m;
        while ((m = tjRe.exec(dec)) !== null) {
          // Try all maps
          let text = '';
          for (const map of allMaps) {
            const t = decodeHex(m[1], map);
            if (t.trim().length > text.trim().length) text = t;
          }
          if (text.trim()) decoded.push(text);
        }
        if (decoded.length > 0) textLines.push(decoded.join(' '));
      }
    } catch(e) {}
    pos = end + 9;
  } else { pos++; }
}

function decodeHex(hex, map) {
  let result = '';
  for (let i = 0; i < hex.length; i += 4) {
    const code = hex.slice(i, i+4).toUpperCase();
    result += map[code] || '';
  }
  return result;
}

const out = textLines.join('\n');
fs.writeFileSync('manual_decoded.txt', out, 'utf8');
console.log('Decoded chars:', out.length);
console.log(out.slice(0, 8000));
