export type GuidePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly href: string };

export type ConnectionGuide = {
  readonly id: 'ai' | 'stt' | 'voice' | 'db';
  readonly title: string;
  readonly steps: readonly {
    readonly label: string;
    readonly parts: readonly GuidePart[];
  }[];
};

export const CONNECTION_GUIDES: readonly ConnectionGuide[];
