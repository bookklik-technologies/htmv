/**
 * Reduced rational numbers over BigInt. Denominator is always positive.
 * All timeline arithmetic in HTMV is exact through this type (spec 3.1).
 */
export interface RationalJSON {
  numerator: string;
  denominator: string;
}

const ZERO_BI = 0n;
const ONE_BI = 1n;

function gcd(a: bigint, b: bigint): bigint {
  a = a < ZERO_BI ? -a : a;
  b = b < ZERO_BI ? -b : b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || ONE_BI;
}

export class Rational {
  readonly num: bigint;
  readonly den: bigint; // positive

  private constructor(num: bigint, den: bigint) {
    this.num = num;
    this.den = den;
  }

  static of(num: bigint | number, den: bigint | number = 1n): Rational {
    const n = typeof num === 'bigint' ? num : BigInt(Math.trunc(num));
    const d = typeof den === 'bigint' ? den : BigInt(Math.trunc(den));
    if (d === ZERO_BI) throw new Error('Rational denominator must be nonzero');
    let nn = d < ZERO_BI ? -n : n;
    let dd = d < ZERO_BI ? -d : d;
    const g = gcd(nn, dd);
    nn /= g;
    dd /= g;
    if (nn === ZERO_BI) return new Rational(ZERO_BI, ONE_BI);
    return new Rational(nn, dd);
  }

  static zero(): Rational {
    return new Rational(ZERO_BI, ONE_BI);
  }

  static fromInteger(n: bigint | number): Rational {
    return Rational.of(n, 1n);
  }

  static fromJSON(json: RationalJSON): Rational {
    return Rational.of(BigInt(json.numerator), BigInt(json.denominator));
  }

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Rational): Rational {
    return Rational.of(this.num * o.num, this.den * o.den);
  }

  div(o: Rational): Rational {
    if (o.num === ZERO_BI) throw new Error('Division by zero rational');
    return Rational.of(this.num * o.den, this.den * o.num);
  }

  neg(): Rational {
    return Rational.of(-this.num, this.den);
  }

  abs(): Rational {
    return this.num < ZERO_BI ? Rational.of(-this.num, this.den) : this;
  }

  cmp(o: Rational): number {
    const l = this.num * o.den;
    const r = o.num * this.den;
    return l < r ? -1 : l > r ? 1 : 0;
  }

  lt(o: Rational): boolean { return this.cmp(o) < 0; }
  lte(o: Rational): boolean { return this.cmp(o) <= 0; }
  gt(o: Rational): boolean { return this.cmp(o) > 0; }
  gte(o: Rational): boolean { return this.cmp(o) >= 0; }
  eq(o: Rational): boolean { return this.cmp(o) === 0; }

  isZero(): boolean { return this.num === ZERO_BI; }
  sign(): number { return this.num < ZERO_BI ? -1 : this.num > ZERO_BI ? 1 : 0; }

  toNumber(): number {
    // May lose precision; only used at floating-point APIs.
    return Number(this.num) / Number(this.den);
  }

  floor(): Rational {
    const q = this.num / this.den; // BigInt truncates toward zero
    if (this.num % this.den === ZERO_BI || this.num >= ZERO_BI) return Rational.fromInteger(q);
    return Rational.fromInteger(q - 1n);
  }

  ceil(): Rational {
    const q = this.num / this.den;
    if (this.num % this.den === ZERO_BI || this.num <= ZERO_BI) return Rational.fromInteger(q);
    return Rational.fromInteger(q + 1n);
  }

  /** Positive modulo: result has same sign as modulus. */
  positiveMod(m: Rational): Rational {
    const r = this.sub(m.mul(this.div(m).floor()));
    return r.sign() < 0 ? r.add(m) : r;
  }

  /** Round-half-up to an integer: floor(x + 1/2), i.e., toward +infinity on ties. */
  roundHalfUp(): Rational {
    const n2 = this.num * 2n + this.den;
    const d2 = this.den * 2n;
    let q = n2 / d2;
    if (n2 % d2 !== ZERO_BI && n2 < ZERO_BI) q += 1n; // BigInt division truncates; round-half-up needs floor
    return Rational.fromInteger(q);
  }

  /** Fractional part in [0,1). */
  frac(): Rational {
    return this.sub(this.floor());
  }

  toJSON(): RationalJSON {
    return { numerator: this.num.toString(), denominator: this.den.toString() };
  }

  toString(): string {
    return this.den === ONE_BI ? this.num.toString() : `${this.num}/${this.den}`;
  }

  /** Safe-integer check for JS-facing frame counts. */
  isSafeInteger(): boolean {
    return this.den === ONE_BI && this.num >= Number.MIN_SAFE_INTEGER && this.num <= Number.MAX_SAFE_INTEGER;
  }

  toSafeInteger(): number {
    if (!this.isSafeInteger()) {
      throw new Error(`Rational ${this.toString()} is not a safe integer`);
    }
    return Number(this.num);
  }

  static parse(text: string): Rational {
    const s = text.trim();
    if (!s) throw new Error('Empty rational');
    const slash = s.indexOf('/');
    if (slash >= 0) {
      const num = s.slice(0, slash).trim();
      const den = s.slice(slash + 1).trim();
      if (!/^-?\d+$/.test(num) || !/^\d+$/.test(den)) throw new Error(`Malformed rational: ${text}`);
      return Rational.of(BigInt(num), BigInt(den));
    }
    if (!/^-?\d+$/.test(s)) throw new Error(`Malformed rational: ${text}`);
    return Rational.of(BigInt(s), 1n);
  }

  static fromDecimalString(text: string): Rational {
    const s = text.trim();
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) throw new Error(`Malformed decimal: ${text}`);
    const sign = m[1] === '-' ? -1n : 1n;
    const intPart = m[2] ?? '0';
    const fracPart = m[3] ?? '';
    if (fracPart) {
      const den = 10n ** BigInt(fracPart.length);
      const num = sign * (BigInt(intPart) * den + BigInt(fracPart));
      return Rational.of(num, den);
    }
    return Rational.of(sign * BigInt(intPart), 1n);
  }
}
