# Animation

Use `hv-animation` to change a supported property over time. Animations follow the enclosing timeline's local clock, so they can be evaluated directly at any frame.

## Declaration forms

For a simple change, set `from` and `to`. For multiple segments, add `hv-keyframe` children. Choose one form per animation:

```html
<hv-animation target="#title" property="translate-y"
              start="0" duration="20f" from="40px" to="0px"
              easing="ease-out" fill="both"></hv-animation>

<hv-animation target="#title" property="opacity" duration="90f" fill="both">
  <hv-keyframe offset="0" value="0"></hv-keyframe>
  <hv-keyframe offset="0.15" value="1"></hv-keyframe>
  <hv-keyframe offset="0.85" value="1"></hv-keyframe>
  <hv-keyframe offset="1" value="0"></hv-keyframe>
</hv-animation>
```

Keyframe offsets must increase strictly and include both `0` and `1`. A keyframe's `easing` applies to the segment that follows it; easing on the last keyframe is ignored. When using keyframes, omit `easing` from the `hv-animation` element or compilation will fail.

## Targets and clock scope

- `target` is a CSS selector scoped to the nearest component instance or composition root. Matches are fixed at compile time. A selector with no matches is an error.
- Supported targets include visual HTML, scene boxes, media gain, plugin leaves, and caption overlays. Timing wrappers and declaration nodes cannot be animated.
- `start` and `duration` use the enclosing timeline's local clock. A target's start offset or media playback rate does not shift the animation's clock.
- Put an animation inside a loop when it targets content in that loop. A declaration outside the loop cannot address its multiple timing instances. Targets must share the declaration's structural clock scope or belong to its ordinary visual subtree.

## Activity, fill, and endpoints

For start `b` and duration `d`, progress is `(clockTime − b)/d`:

- During `[b, b+d)` the easing/keyframes are evaluated.
- `fill` defaults to `none`. `backwards` applies the initial value before `b`; `forwards` holds the final evaluated value at and after `b+d`; `both` does both.
- Fill applies only while the enclosing timeline and target are active. It does not make an inactive target visible. In a loop, fill is reevaluated using each iteration's clock.
- Ordinary easing and keyframes finish at the declared endpoint. A spring holds its calculated value at the declared duration, which may differ from `to`. See [Springs](#springs).

## Property registry

| Property | Values / interpolation | Effect |
|---|---|---|
| `opacity` | Unitless 0–1 | Isolated group alpha |
| `translate-x` / `translate-y` | Same-unit px or % | Percent relative to the untransformed target box |
| `rotate` | deg | 2D rotation (no shortest-path wrapping) |
| `scale-x` / `scale-y` | Positive unitless | 2D scale |
| `color` / `background-color` | Solid sRGB | Premultiplied-alpha channel interpolation |
| `width` / `height` / `left` / `top` | px | Requires layout invalidation |
| `gain` | 0–4 | Media leaves, evaluated per output audio sample; **replaces** the base gain in its contribution window (no second multiplication) |
| `text-number` | Finite numeric | Plain text leaf; integer round-half-away-from-zero by default; triggers text/layout invalidation |

Interpolation units must match. On nodes with animated transform channels, static CSS `transform` must be `none`; the animated matrix is `T(origin) · T(tx,ty) · R(θ) · S(sx,sy) · T(−origin)` with the origin defaulting to the border-box center. Static finite 2D transforms on unanimated nodes are supported.

Before painting, the engine clamps opacity and RGB channels to `[0,1]`, gain to `[0,4]`, and dimensions to nonnegative values. Scale must stay positive; a nonpositive sample produces a diagnostic. Translation, rotation, and numeric text may overshoot. Nonfinite values are rejected before reaching browser APIs.

## Conflicts

V1 supports only `mode="replace"`. Two animations cannot contribute to the same property on the same target at the same time. The compiler reports `E_ANIMATION_CONFLICT` for overlapping active or fill intervals.

For example, a forward-filled opacity animation can conflict with a later opacity animation even if their active intervals do not overlap. Combine them into one keyframe animation or reduce the fill interval. Different transform channels, such as translation and rotation, can run together.

## Easing

- `linear`, `ease-in` (`cubic-bezier(0.42,0,1,1)`), `ease-out` (`cubic-bezier(0,0,0.58,1)`), `ease-in-out` (`cubic-bezier(0.42,0,0.58,1)`).
- `cubic-bezier(x1,y1,x2,y2)`: x controls must be in `[0,1]`; solved deterministically.
- `steps(n, start | end)`: exact discrete evaluation on `0 ≤ p < 1`; endpoint `p = 1` returns `1`; `n` is a positive integer.

Overshooting easing is permitted; values are clamped per the registry above.

## Springs

Spring easing uses `spring(mass,stiffness,damping,initialVelocity)` and is available only with `from` and `to`. Mass and stiffness must be positive, damping nonnegative, and initial velocity finite.

The response is evaluated from elapsed seconds, so changing the animation duration changes where the motion ends. The engine solves `m·x″ + c·x′ + k·(x−1) = 0`, with `x(0)=0` and `x′(0)=v`, using closed-form expressions for each damping regime:

```text
α = c/(2m), ω₀ = √(k/m)
underdamped: x(t) = 1 + e^(−αt)·[−cos(ωt) + (v−α)/ω·sin(ωt)]
critical:    x(t) = 1 + e^(−αt)·[−1 + (v−α)·t]
overdamped:  roots r1, r2 = −α ± √(α²−ω₀²); x(t) = 1 + A·e^(r1·t) + B·e^(r2·t)
```

The property value is `from + (to − from)·x(t)`. Forward fill holds the response at `x(d)` when the duration ends. Forcing it to `1` would cause a snap if the spring were still moving. The engine reports `W_SPRING_UNSETTLED` when `|x(d)−1| > 0.001` or `|x′(d)| > 0.001`.

The closed-form calculation gives the same result regardless of frame order; the engine does not integrate the spring from the previous frame.

Use `hv-animation` for source animations. Strict validation rejects native CSS transitions, autoplaying CSS animations, and WAAPI animations.
