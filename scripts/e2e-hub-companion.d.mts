// Types for e2e-hub-companion.mjs (the `hub` e2e suite's runs with 52in1's companion script), for the tests that read them.

/** What 52in1's Worker adds to a game page: the companion, as a script tag. */
export const COMPANION: string;
/** `html` with the companion as its first script, where 52in1's Worker puts it: the top of `<head>`, else before the first `<script>`, else the top of `<body>`. */
export function withCompanion(html: string): string;
