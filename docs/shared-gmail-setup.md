# Configurare Gmail comun pentru WorkControl

WorkControl trimite rapoartele de revizie, rapoartele de interventie si emailurile
pentru comenzile de piese numai din contul comun `liftultau@gmail.com`.

Autorizarea se face o singura data de administrator. Utilizatorii WorkControl nu vad
parola, client secret-ul sau refresh token-ul si nu trebuie sa se autentifice individual
in Gmail.

## 1. Activeaza Gmail API

1. Deschide Google Cloud Console pentru proiectul Firebase `workcontrol-53b1d`.
2. Intra in **APIs & Services > Library**.
3. Cauta **Gmail API**.
4. Apasa **Enable**.

## 2. Configureaza Google Auth Platform

1. Intra in **Google Auth Platform > Branding**.
2. Foloseste numele aplicatiei `WorkControl` si completeaza emailul de suport.
3. In **Audience**, alege `External` daca proiectul nu apartine unui Google Workspace
   gestionat.
4. Cat timp aplicatia este in modul Testing, adauga `liftultau@gmail.com` la **Test users**.
5. In **Data Access**, adauga exact scope-ul:

   `https://www.googleapis.com/auth/gmail.send`

Nu adauga scope-uri Gmail mai largi. WorkControl are nevoie numai sa trimita mesaje.

## 3. Creeaza clientul OAuth

1. Intra in **Google Auth Platform > Clients**.
2. Creeaza **OAuth client ID** de tip **Web application**.
3. Denumire recomandata: `WorkControl Shared Gmail Sender`.
4. La **Authorized redirect URIs** adauga exact:

   `https://developers.google.com/oauthplayground`

5. Salveaza separat `Client ID` si `Client secret`. Nu le pune in repository si nu le
   trimite in chat.

## 4. Genereaza refresh token-ul contului comun

1. Deschide `https://developers.google.com/oauthplayground/`.
2. Apasa rotita din dreapta sus.
3. Bifeaza **Use your own OAuth credentials**.
4. Introdu `Client ID` si `Client secret` create la pasul anterior.
5. La **Step 1**, introdu scope-ul:

   `https://www.googleapis.com/auth/gmail.send`

6. Apasa **Authorize APIs**.
7. Autentifica-te explicit cu `liftultau@gmail.com` si accepta accesul.
8. La **Step 2**, apasa **Exchange authorization code for tokens**.
9. Pastreaza valoarea `refresh_token`. Nu o pune in repository si nu o trimite in chat.

Pentru functionare permanenta, muta aplicatia OAuth din `Testing` in `Production` dupa
testare. Pentru o aplicatie External, Google poate solicita configurari sau verificari
suplimentare. In modul Testing, refresh token-urile pot expira dupa sapte zile.

## 5. Salveaza credentialele in Firebase Secrets

Din folderul proiectului WorkControl ruleaza comenzile de mai jos. Firebase CLI va cere
fiecare valoare in terminal; lipeste valoarea numai in acel prompt.

```powershell
npx firebase-tools functions:secrets:set GMAIL_OAUTH_CLIENT_ID --project workcontrol-53b1d --account ionut.matura30@gmail.com
npx firebase-tools functions:secrets:set GMAIL_OAUTH_CLIENT_SECRET --project workcontrol-53b1d --account ionut.matura30@gmail.com
npx firebase-tools functions:secrets:set GMAIL_OAUTH_REFRESH_TOKEN --project workcontrol-53b1d --account ionut.matura30@gmail.com
```

Verifica doar existenta secretelor, fara sa afisezi valorile:

```powershell
npx firebase-tools functions:secrets:access GMAIL_OAUTH_CLIENT_ID --project workcontrol-53b1d --account ionut.matura30@gmail.com *> $null
npx firebase-tools functions:secrets:access GMAIL_OAUTH_CLIENT_SECRET --project workcontrol-53b1d --account ionut.matura30@gmail.com *> $null
npx firebase-tools functions:secrets:access GMAIL_OAUTH_REFRESH_TOKEN --project workcontrol-53b1d --account ionut.matura30@gmail.com *> $null
```

## 6. Publica functia

Dupa ce toate cele trei secrete exista, publica functia si interfata:

```powershell
npx firebase-tools deploy --only functions:sendSharedMaintenanceEmail,hosting --project workcontrol-53b1d --account ionut.matura30@gmail.com
```

## 7. Test functional

1. Autentifica-te in WorkControl cu un utilizator activ.
2. Deschide **Mentenanta > Genereaza raport**.
3. Verifica faptul ca tehnicianul curent este selectat implicit si apare numai numele lui.
4. Selecteaza clientul si confirma ca lista de sugestii se inchide.
5. Genereaza un raport de test pentru o adresa controlata.
6. Confirma ca emailul primit are expeditorul `liftultau@gmail.com` si PDF-ul este atasat
   efectiv, nu doar ca link.
7. Testeaza si **Comenzi piese** pentru emailul furnizorului si oferta clientului.

Functia verifica utilizatorul activ, compania si documentele salvate. Destinatarul,
subiectul si atasamentele nu sunt acceptate arbitrar din browser.

## Rotirea accesului

Daca un secret a fost expus, revoca accesul aplicatiei din contul Google, genereaza un
refresh token nou si actualizeaza secretul Firebase. Nu este necesara schimbarea parolei
utilizatorilor WorkControl.
