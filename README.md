# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## WorkControl - notificari push in fundal (PWA)

Ca notificarea sa ajunga chiar daca aplicatia este inchisa (inclusiv proces inchis), trebuie Firebase Cloud Messaging (FCM).

### 1) Frontend (.env)
Adauga in `.env`:

```bash
VITE_FIREBASE_VAPID_KEY=PASTE_WEB_PUSH_CERTIFICATE_KEY_PAIR_PUBLIC_KEY
```

Cheia se ia din Firebase Console -> Project Settings -> Cloud Messaging -> Web Push certificates.

### 2) Ce salveaza aplicatia
Aplicatia salveaza token-ul FCM in colectia Firestore `pushTokens` cand userul apasa `Activeaza notificari push (fundal)` din pagina Notificari.

### 3) Backend obligatoriu (Cloud Function / server)
Cand creezi o notificare in Firestore, trebuie sa trimiti si push catre token-urile userului:
- iei token-urile din `pushTokens` dupa `userId`
- trimiti prin Firebase Admin SDK `sendEachForMulticast`
- payload recomandat: `title`, `body`, `data.path` (ex: `/notifications`)

Fara acest pas de backend, browserul nu poate afisa notificare daca aplicatia e inchisa complet.
