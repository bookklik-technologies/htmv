export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  compositionId?: string;
  nodeId?: string;
  instancePath?: string;
  attribute?: string;
  sourceLocation?: { line: number; column: number };
  suggestion?: string;
  recoverable: boolean;
}

export const DiagnosticCodes = {
  E_TIME_UNIT: 'E_TIME_UNIT',
  E_ROOT_FRAME_ALIGNMENT: 'E_ROOT_FRAME_ALIGNMENT',
  E_DURATION_CYCLE: 'E_DURATION_CYCLE',
  E_STYLE_UNSUPPORTED: 'E_STYLE_UNSUPPORTED',
  E_ANIMATION_CONFLICT: 'E_ANIMATION_CONFLICT',
  E_ASSET_FETCH: 'E_ASSET_FETCH',
  E_CORS: 'E_CORS',
  E_CODEC_DECODE: 'E_CODEC_DECODE',
  E_CODEC_ENCODE: 'E_CODEC_ENCODE',
  E_AUDIO_DELAY_UNVERIFIED: 'E_AUDIO_DELAY_UNVERIFIED',
  E_FREEZE_AUDIO: 'E_FREEZE_AUDIO',
  E_RESOURCE_LIMIT: 'E_RESOURCE_LIMIT',
  E_STORAGE_QUOTA: 'E_STORAGE_QUOTA',
  E_WRITER: 'E_WRITER',
  E_BUSY: 'E_BUSY',
  E_DISPOSED: 'E_DISPOSED',
  E_ABORTED: 'E_ABORTED',
  W_NONPORTABLE_FONT: 'W_NONPORTABLE_FONT',
  W_AUDIO_CLIPPING: 'W_AUDIO_CLIPPING',
  W_SPRING_UNSETTLED: 'W_SPRING_UNSETTLED'
} as const;

export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

export class CompilationError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(diagnostics: readonly Diagnostic[]) {
    super(
      diagnostics.length === 1
        ? diagnostics[0].code + ': ' + diagnostics[0].message
        : `${diagnostics.length} compilation errors: ${diagnostics.map((d) => d.code).join(', ')}`
    );
    this.name = 'CompilationError';
    this.diagnostics = diagnostics;
  }
}

export function diag(
  severity: Diagnostic['severity'],
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {}
): Diagnostic {
  return {
    severity,
    code,
    message,
    recoverable: severity !== 'error',
    ...extra
  };
}

export function error(code: string, message: string, extra: Partial<Diagnostic> = {}): Diagnostic {
  return diag('error', code, message, extra);
}

export function warning(code: string, message: string, extra: Partial<Diagnostic> = {}): Diagnostic {
  return diag('warning', code, message, extra);
}
