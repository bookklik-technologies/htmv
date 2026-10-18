# Templates and data binding

Templates let you reuse markup and generate compositions from JSON data. The compiler expands templates and resolves bindings once, before evaluating any frames. To change the input data, compile a new revision.

## Input data

A composition root can declare default props and a validation schema in JSON script blocks. These blocks hold data and do not execute:

```html
<script type="application/json" data-hv-props>
  {"title":"Quarterly results","items":[{"id":"sales","label":"Sales","value":42}]}
</script>
<script type="application/json" data-hv-schema>
  {"type":"object","properties":{"title":{"type":"string"}},
   "required":["title"],"additionalProperties":true}
</script>
```

Props passed to `compile(source, { props })` replace defaults by root key, then the merged object is validated. Nested objects are replaced as whole values rather than merged recursively. The compiler copies and deeply freezes the inputs.

The schema supports the types `object`, `array`, `string`, `number`, `integer`, `boolean`, and `null`, with these keywords: `properties`, `required`, `additionalProperties`, `items`, `enum`, `minimum`, `maximum`, `minLength`, `maxLength`, `minItems`, and `maxItems`. Other keywords produce a diagnostic. This is a subset of JSON Schema.

## Binding vocabulary

| Attribute | Purpose |
|---|---|
| `data-hv-text="props.title"` | Set textContent on a plain text leaf |
| `data-hv-src="props.image"` | Set a supported media/image src after URL validation |
| `data-hv-style-width="item.width"` | Bind one explicitly supported CSS property (from the style registry) |
| `data-hv-attr-gain="props.musicGain"` | Bind one explicitly supported library attribute (names restricted by element schema) |

Bindings read paths rooted at `props`, `item`, `index`, or `parentProps`. Use dots for object properties and nonnegative integer indexes for arrays, such as `props.items[0].label`.

Paths cannot contain function calls, arithmetic, interpolation, assignment, optional chaining, or references to the DOM. Missing paths and access to `__proto__`, `prototype`, or `constructor` are errors. Bindings set text or validated attribute values; they cannot write HTML, event handlers, or executable script.

Calculate derived values in application code before compilation, then pass the result as data.

## Repetition and conditionals

```html
<template data-hv-each="props.items" data-hv-as="item" data-hv-key="item.id">
  <div class="stat">
    <span data-hv-text="item.label"></span>
    <span data-hv-text="item.value"></span>
  </div>
</template>
<template data-hv-if="props.showFooter">
  <p>Confidential</p>
</template>
```

- `data-hv-each` must resolve to an array. In v1, `data-hv-as` must be `item`. Pass outer values through component props when nesting loops.
- `data-hv-key` is required. Each sibling needs a unique string or number key; items expand in array order.
- A condition must be boolean. Cycles, oversized expansions, and duplicate keys fail validation.

## Components

```html
<template id="stat-card" data-hv-component>
  <div class="stat">
    <h2 data-hv-text="props.label"></h2>
    <p data-hv-text="props.value"></p>
  </div>
</template>
<hv-use template="#stat-card" duration="90f"
        props='{"label":"Customers","value":1200}'></hv-use>
```

- Each instance gets a scoped ID namespace, local timing, and a frozen props object (strict JSON object).
- A component template may contain one inert `data-hv-schema` block for its props. Root props reach a component only if passed explicitly or via read-only `parentProps`.
- Expansion inserts the template's children at the `hv-use` position. If the component needs a single layout box, add a container inside the template.
- Template-local ID selectors are rewritten with the instance namespace in animation references and supported CSS. Class selectors remain composition-local.
- Default expansion limits are 32 levels and 10,000 nodes. Larger expansions require an explicit resource policy.

## Assets

```html
<hv-assets>
  <hv-asset id="brand-font" kind="font" src="./assets/brand.woff2"
            family="Brand" weight="700"></hv-asset>
  <hv-asset id="intro" kind="video" src="./assets/intro.mp4"></hv-asset>
  <hv-asset id="music" kind="audio" src="./assets/music.wav"></hv-asset>
</hv-assets>
```

The supported asset kinds are `image`, `video`, `audio`, `font`, `captions`, and `json`. Font assets also require `family`. Reference a declared asset with `asset:ID`. Relative URLs resolve against `baseURL`, or the document URL when `baseURL` is omitted, and are stored as absolute references.

- To supply a user-selected file, pass `compile(source, { assets: { intro: file } })`. A `File` or `Blob` can override a declaration or provide an asset referenced as `asset:intro`.
- Asset preparation includes fetching bytes, reading metadata, checking decoder configuration, decoding images, loading font faces, parsing captions, and initializing plugins. Fonts are ready before rendering starts. System-font fallbacks produce `W_NONPORTABLE_FONT`; see [font policy](/reference/javascript-api.md#source-and-compile).
- Asset `integrity` uses standard `sha256-BASE64` digests and is verified before decode; mismatch is an error.
- Cache keys include the content hash, decode options, and versions. Repeated references share fetches and preparation, subject to [resource limits](/reference/diagnostics.md#resource-policy).

Load JSON assets through the application's asset preparation path and pass their data as props. Bindings do not fetch JSON URLs.

## Binding precedence and typed values

- Bindings resolve before required-attribute validation, selector resolution, and IR generation.
- Every enumerated element-schema attribute can be bound via `data-hv-attr-NAME`, except `id`, template references, source trust-policy fields, and declaration-registry keys.
- A binding and an explicit value cannot both set the same attribute. For source URLs, use `data-hv-src`.
- Paths can resolve to any JSON value, but the destination must accept its type. Numeric attributes take validated numbers. Text accepts strings, numbers, or booleans; format objects and arrays in application code first. Style bindings must be strings that match the supported property's CSS grammar.
