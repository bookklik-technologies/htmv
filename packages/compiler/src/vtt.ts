/**
 * WebVTT subset parser (spec 10.5):
 * ordinary cues with start/end and plain text, optional cue identifiers;
 * no STYLE/REGION blocks, ruby, voice styling, or inline timestamp/karaoke tags.
 * Unsupported constructs are diagnosed, not partially misinterpreted.
 */
export interface ParsedVttCue {
  identifier?: string;
  start: string; // exact decimal "00:00:01.500" kept as rational string seconds
  end: string;
  text: string;
}

export interface VttParseResult {
  cues: ParsedVttCue[];
  diagnostics: string[];
}

const TIMESTAMP = /^(\d{2,}):(\d{2}):(\d{2})\.(\d{3})$|^(\d{2}):(\d{2})\.(\d{3})$/;

export function parseVttTimestamp(text: string): string | null {
  const m = TIMESTAMP.exec(text.trim());
  if (!m) return null;
  let hours: string, minutes: string, seconds: string, ms: string;
  if (m[1] !== undefined) {
    hours = m[1];
    minutes = m[2];
    seconds = m[3];
    ms = m[4];
  } else {
    hours = '00';
    minutes = m[5] ?? '00';
    seconds = m[6] ?? '00';
    ms = m[7] ?? '000';
  }
  const totalMs = (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 + Number(ms);
  if (totalMs % 1000 === 0) return String(totalMs / 1000);
  let a = totalMs, b = 1000;
  while (b !== 0) { const t = a % b; a = b; b = t; }
  return `${totalMs / a}/${1000 / a}`;
}

export function parseVtt(vttText: string): VttParseResult {
  const diagnostics: string[] = [];
  const cues: ParsedVttCue[] = [];
  const normalized = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  let i = 0;
  if (lines[0] !== undefined && /^WEBVTT/.test(lines[0].trim())) {
    i = 1;
  }
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') {
      i++;
      continue;
    }
    if (/^(STYLE|REGION|NOTE)\b/.test(line)) {
      diagnostics.push(`Unsupported VTT block "${line.split(/[ \t]/)[0]}"; the admitted subset is ordinary cues only.`);
      // skip block
      while (i < lines.length && lines[i].trim() !== '') i++;
      i++;
      continue;
    }
    // Optional identifier line
    let identifier: string | undefined;
    if (!line.includes('-->')) {
      const next = lines[i + 1];
      if (next !== undefined && next.includes('-->')) {
        identifier = line;
        i++;
        continue;
      }
      diagnostics.push(`Unrecognized VTT content: "${line}".`);
      i++;
      continue;
    }
    const timingMatch = /(\S+)\s+-->\s+(\S+)(.*)$/.exec(line);
    if (!timingMatch) {
      diagnostics.push(`Malformed cue timing: "${line}".`);
      i++;
      continue;
    }
    const start = parseVttTimestamp(timingMatch[1]);
    const end = parseVttTimestamp(timingMatch[2]);
    const settings = timingMatch[3].trim();
    if (start === null || end === null) {
      diagnostics.push(`Malformed VTT timestamp in cue "${line}".`);
      i++;
      continue;
    }
    if (settings) {
      diagnostics.push(`Cue settings are outside the admitted subset and were ignored: "${settings}".`);
    }
    // Collect text lines until blank
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      const textLine = lines[i];
      if (/<[^>]*timestamp[^>]*>|\{\\[\s\S]*\}/.test(textLine)) {
        diagnostics.push(`Inline timestamp/karaoke tags are not admitted: "${textLine}".`);
      }
      textLines.push(textLine.replace(/<[^>]*>/g, '')); // strip inline tags; cue content is safe plain text
      i++;
    }
    cues.push({ identifier, start, end, text: textLines.join('\n').trim() });
  }
  return { cues, diagnostics };
}
