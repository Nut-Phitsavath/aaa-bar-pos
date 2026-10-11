// eslint-config-next 16 ships flat config as a default export. Routing it
// through FlatCompat makes ESLint validate a flat array as eslintrc and die on
// a circular plugin reference before it lints a single file.
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * The linter this project has had a script for and never had installed.
 *
 * `npm run lint` has been in package.json from the start and failed with
 * "'eslint' is not recognized", so nothing has ever checked this codebase for a
 * dead import or a missing hook dependency. That is how a `no-scrollbar` class
 * came to sit on eight elements across four files, defined nowhere, showing the
 * platform's default scrollbar on all of them.
 *
 * Starts from Next's own config rather than a hand-rolled rule list: it already
 * carries the React, hooks and a11y rules that matter here, and a list invented
 * today is a list nobody maintains.
 *
 * The three rules turned off below are turned off deliberately, each for a
 * reason that is true of this codebase rather than to quiet the output.
 */
export default [
    ...coreWebVitals,
    ...typescript,
    {
        ignores: [
            '.next/**',
            'node_modules/**',
            'backups/**',
            'next-env.d.ts',
            // Seed and check scripts are CommonJS, run by hand, never shipped.
            'prisma/*.js',
            'scripts/**',
        ],
    },
    {
        // components/ui is vendored shadcn. We did not write it and we do not
        // hand-edit it, so its findings are noise against our own.
        files: ['components/ui/**'],
        rules: {
            'react-hooks/purity': 'off',
            'react-hooks/set-state-in-effect': 'off',
            'react-hooks/immutability': 'off',
        },
    },
    {
        rules: {
            // The rule that would have caught the dead icon imports. Stays on.
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],

            // Two rules from the React Compiler suite that landed with
            // eslint-plugin-react-hooks 7, between them 53 findings across
            // screens that have been working for months. They are worth acting
            // on - a synchronous setState in an effect is a wasted render, and
            // mutating state is how a stale read happens - but they are a
            // backlog, not a gate. Red on the first run is how a linter gets
            // switched off by Friday.
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/immutability': 'warn',

            // This one stays an ERROR on purpose. It caught a real bug the
            // first time it ran: app/menu/recipes/page.tsx defines RecipeSection
            // inside its own render, so the component is a new type every
            // render and React remounts it - which drops the input's focus on
            // every keystroke. The inventory page carries a comment explaining
            // exactly this trap and works around it; the recipe editor walked
            // into it. A rule that finds that is not a rule to downgrade.
            'react-hooks/static-components': 'error',

            // API payloads are typed `any` at the fetch boundary throughout,
            // because the routes are the contract and there is no shared schema
            // yet. Flagging every one buries everything worth reading.
            '@typescript-eslint/no-explicit-any': 'off',

            // Menu photos are served off the local disk on a LAN box with no
            // image optimiser in front of it.
            '@next/next/no-img-element': 'off',
        },
    },
]
