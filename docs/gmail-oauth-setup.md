# Gmail OAuth pentru rapoarte de mentenanta

WorkControl creeaza un draft Gmail si ataseaza raportul PDF ca fisier MIME real. Utilizatorul
verifica draftul si apasa manual `Trimite`. Aplicatia cere numai scope-ul
`https://www.googleapis.com/auth/gmail.compose`.

## Configurare Google Cloud

1. Selecteaza proiectul Google Cloud `workcontrol-53b1d`.
2. Activeaza Gmail API. In proiectul production API-ul este deja activat.
3. In `Google Auth Platform > Branding`, configureaza:
   - nume aplicatie: `WorkControl`;
   - email suport;
   - pagina principala: `https://workcontrol-53b1d.web.app`;
   - politica de confidentialitate: `https://workcontrol-53b1d.web.app/privacy`;
   - termeni: `https://workcontrol-53b1d.web.app/terms`.
4. In `Audience`, foloseste `External` daca sunt folosite conturi Gmail personale. Cat timp
   aplicatia este in modul Testing, adauga drept test users toate conturile Gmail care trimit
   rapoarte.
5. In `Data Access`, adauga scope-ul Gmail Compose:
   `https://www.googleapis.com/auth/gmail.compose`.
6. In `Clients`, creeaza un client OAuth de tip `Web application` cu:
   - nume: `WorkControl Web`;
   - Authorized JavaScript origins:
     - `https://workcontrol-53b1d.web.app`
     - `https://workcontrol-53b1d.firebaseapp.com`
     - `http://localhost:5173`
   - Authorized redirect URIs:
     - `https://workcontrol-53b1d.web.app/maintenance?tab=report`
     - `https://workcontrol-53b1d.firebaseapp.com/maintenance?tab=report`
     - `http://localhost:5173/maintenance?tab=report`
7. Copiaza Client ID-ul Web. Client secret-ul nu este folosit de frontend si nu trebuie pus in
   repository.

## Build si deploy

Seteaza Client ID-ul numai in mediul local sau CI, apoi reconstruieste si publica Hosting:

```powershell
$env:VITE_GOOGLE_CLIENT_ID="CLIENT_ID_UL_WEB"
npm run build
firebase deploy --only hosting --project workcontrol-53b1d --account ionut.matura30@gmail.com
```

Nu adauga valoarea intr-un fisier urmarit de Git. `.env.example` contine doar numele
variabilei.

## Verificare

1. Deschide `Mentenanta > Genereaza raport`.
2. Confirma ca tehnicianul autentificat este selectat implicit.
3. Selecteaza clientul si verifica inchiderea listei de sugestii.
4. Apasa `Autorizeaza Gmail` si accepta scope-ul Compose.
5. Genereaza raportul.
6. Verifica in draftul Gmail ca PDF-ul apare in zona de atasamente, nu ca link in corp.
7. Verifica destinatarul, subiectul si continutul, apoi apasa manual `Trimite`.
