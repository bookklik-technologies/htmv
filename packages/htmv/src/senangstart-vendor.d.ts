declare module '@bookklik/senangstart-icons/icons' {
  const icons: Record<string, string>;
  export default icons;
}

declare module '@bookklik/senangstart-shapes/shapes' {
  const shapes: Record<string, string>;
  export default shapes;
  export const catalog: {
    shapes: { slug: string; name: string; category: string; variants: string[]; defaultVariant: string; assets: Record<string, string> }[];
  };
}
