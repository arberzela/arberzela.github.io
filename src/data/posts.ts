// Blog posts shown under /blog/. Each post's HTML body lives in src/content/blog/<slug>/body.html
// and its media under public/blog/<slug>/media/.
export interface Post {
    slug: string;
    title: string;
    subtitle: string;
    date: string; // ISO date (YYYY-MM-DD)
    summary: string;
    cover: string;
    tags: string[];
    /** Links shown in the post hero. */
    paper?: string;
    code?: string;
    /** Custom interactive hero; posts without one show their cover figure on the dark grid. */
    hero?: "sfprm-sphere";
}

export const posts: Post[] = [
    {
        slug: "sfprm",
        title: "Spherical Fixed-Point Reasoners",
        subtitle: "Adaptive loop halting on the hypersphere",
        date: "2026-10-20",
        summary: "Run a looped transformer's fixed-point solver on the unit sphere: the state cannot blow up, halting becomes an angle, and the geometry of the computation becomes readable.",
        cover: "/blog/sfprm/media/overview.png",
        tags: ["looped transformers", "adaptive computation", "paper"],
        paper: "https://arxiv.org/abs/2610.25646",
        code: "https://github.com/arberzela/sfprm",
        hero: "sfprm-sphere"
    }
];
