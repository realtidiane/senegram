<div align="center">

# 🇸🇳 Senegram

### *Une messagerie temps-réel made in Sénégal*

Chat, appels audio/vidéo, groupes, partage de fichiers — le tout en local, sans cloud, sans Docker.

[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4-010101?logo=socket.io&logoColor=white)](https://socket.io)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com)
[![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License](https://img.shields.io/badge/license-MIT-green)](#-licence)

</div>

---

## 📖 Table des matières

- [À propos](#-à-propos)
- [Fonctionnalités](#-fonctionnalités)
- [Architecture](#-architecture)
- [Stack technique](#-stack-technique)
- [Démarrage rapide](#-démarrage-rapide)
- [Configuration](#-configuration)
- [Utilisation sur mobile (LAN)](#-utilisation-sur-mobile-lan--https)
- [API REST](#-api-rest)
- [Événements Socket.IO](#-événements-socketio)
- [Schéma de la base](#-schéma-de-la-base-de-données)
- [Scripts utilitaires](#-scripts-utilitaires-windows)
- [Roadmap](#-roadmap)
- [Contribuer](#-contribuer)
- [Auteur](#-auteur)

---

## ✨ À propos

**Senegram** est une application de messagerie instantanée inspirée de Telegram et WhatsApp, pensée et codée au Sénégal 🇸🇳. L'objectif : prouver qu'on peut bâtir une messagerie complète — chat texte, partage multimédia, appels audio/vidéo en WebRTC — **100 % en local**, sans dépendre d'un service cloud externe et sans conteneurisation.

C'est un projet **full-stack pédagogique et fonctionnel** : tout le code est lisible, commenté en français, et tourne sur n'importe quelle machine équipée de Node.js et MySQL.

> 🎯 **Cas d'usage** : intranet d'entreprise, projet de fin d'études, base pour un produit local, ou tout simplement apprendre comment marche une vraie messagerie.

---

## 🚀 Fonctionnalités

### 🔐 Authentification & Profils
- Inscription / connexion par **JWT** (jsonwebtoken + bcryptjs)
- Profil personnalisable : avatar uploadable, bio, téléphone
- Changement de mot de passe sécurisé

### 💬 Messagerie
- Chat **1-à-1** et **groupes** (création, ajout/suppression de membres, rôles)
- Messages texte avec **édition** et **suppression**
- **Réponse** à un message (citation)
- **Indicateurs de lecture** en temps réel
- **Indicateur "est en train d'écrire"** (typing)
- **Présence** en ligne / hors ligne / `last_seen`

### 📎 Partage de fichiers
- 📷 Images (JPG, PNG, WEBP, GIF…)
- 🎬 Vidéos (MP4, WEBM…)
- 🎙️ Audio (MP3, OGG, WAV…)
- 📄 Documents (PDF, DOCX, XLSX, PPTX, TXT…)
- Limite par défaut : **50 Mo** (configurable)

### 📞 Appels audio & vidéo (WebRTC)
- Appels **1-à-1** audio ou vidéo
- Signaling via **Socket.IO**, médias en pair-à-pair via **WebRTC**
- Serveurs **STUN** Google par défaut, **TURN** configurable pour passer les NAT restrictifs
- Contrôles : couper le micro, couper la caméra, raccrocher
- Timer d'appel + interface plein écran
- Historique des appels persisté en base

### 🎨 Interface
- Design moderne, responsive (desktop + mobile)
- Palette aux couleurs du Sénégal 🇸🇳 (vert, jaune, rouge)
- **TailwindCSS** + composants React découpés
- Mode clair par défaut

---

## 🏗️ Architecture

```
┌───────────────────────────┐         ┌───────────────────────────┐
│       FRONTEND            │         │        BACKEND            │
│   React + Vite + Tailwind │◄───────►│  Express + Socket.IO      │
│                           │  HTTP   │                           │
│  • AuthContext            │  WS     │  • REST API (/api/*)      │
│  • SocketContext          │         │  • Sockets (chat + calls) │
│  • CallContext (WebRTC)   │         │  • Multer (uploads)       │
│  • Pages: Login/Register  │         │  • JWT middleware         │
│           Home (chat)     │         │                           │
└───────────────────────────┘         └─────────────┬─────────────┘
                                                    │
                                            ┌───────▼────────┐
                                            │   MySQL 8      │
                                            │  base senegram │
                                            └────────────────┘
```

### Arborescence

```
senegram/
├── backend/
│   ├── config/              # db.js (pool MySQL), multer.js (uploads)
│   ├── controllers/         # auth, users, conversations, messages,
│   │                        # groups, uploads, calls
│   ├── middlewares/         # auth.js (JWT)
│   ├── routes/              # routes Express
│   ├── sockets/             # chatSocket + callSocket (signaling WebRTC)
│   ├── database/
│   │   └── schema.sql       # schéma MySQL complet + utilisateurs de démo
│   ├── uploads/             # fichiers utilisateurs (gitignoré)
│   ├── scripts/             # gen-cert.js (HTTPS auto-signé)
│   ├── server.js            # point d'entrée Express + Socket.IO
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/      # ChatList, ChatWindow, MessageBubble,
│   │   │                    # CallOverlay, ProfileModal…
│   │   ├── context/         # AuthContext, SocketContext, CallContext
│   │   ├── pages/           # Login, Register, Home
│   │   ├── services/        # api.js (axios), socket.js (socket.io-client)
│   │   ├── utils/           # webrtc.js, conversation.js
│   │   └── main.jsx
│   ├── tailwind.config.js
│   └── package.json
│
└── scripts/                 # scripts .bat (Windows) : setup, run, firewall…
```

---

## 🧰 Stack technique

| Couche       | Technologies                                                    |
|--------------|-----------------------------------------------------------------|
| **Frontend** | React 18, Vite 5, TailwindCSS 3, React Router 6, Axios, Lucide  |
|              | socket.io-client 4, react-hot-toast, date-fns                   |
| **Backend**  | Node.js 18+, Express 4, Socket.IO 4, MySQL2 (pool de connexions)|
|              | JWT, bcryptjs, Multer (uploads), Helmet, CORS, Morgan           |
|              | express-rate-limit, selfsigned (HTTPS dev)                      |
| **DB**       | MySQL 8 (XAMPP / WAMP / standalone)                             |
| **Temps-réel** | Socket.IO (chat, présence, typing, signaling WebRTC)          |
| **Médias**   | WebRTC natif navigateur, STUN Google (TURN optionnel)           |

---

## ⚡ Démarrage rapide

### Prérequis

- **Node.js 18+** & **npm**
- **MySQL 8+** (recommandé via [XAMPP](https://www.apachefriends.org/) ou [WAMP](https://www.wampserver.com/))
- Un navigateur moderne (Chrome, Edge, Firefox) pour WebRTC
- **Git** (optionnel)

### 1️⃣ Cloner le projet

```bash
git clone https://github.com/realtidiane/senegram.git
cd senegram
```

### 2️⃣ Importer la base de données

**Avec phpMyAdmin (XAMPP) :**
1. Démarre **Apache + MySQL** dans XAMPP
2. Va sur `http://localhost/phpmyadmin`
3. Onglet **Importer** → choisis `backend/database/schema.sql` → **Exécuter**

**En ligne de commande :**
```bash
mysql -u root -p < backend/database/schema.sql
```

✅ La base `senegram` est créée avec **toutes les tables** + **3 utilisateurs de démo** :

| Username  | Mot de passe |
|-----------|--------------|
| `aminata` | `password`   |
| `moussa`  | `password`   |
| `fatou`   | `password`   |

### 3️⃣ Lancer le backend

```bash
cd backend
cp .env.example .env        # copie + édite si besoin (DB_PASSWORD, JWT_SECRET…)
npm install
npm run dev                 # mode dev (nodemon, hot-reload)
# ou : npm start            # mode production
```

➡️ API disponible sur **http://localhost:5000**

### 4️⃣ Lancer le frontend

Dans un **second terminal** :

```bash
cd frontend
npm install
npm run dev
```

➡️ App disponible sur **http://localhost:5173** 🎉

---

## ⚙️ Configuration

### `backend/.env`

```env
# Serveur
PORT=5000
NODE_ENV=development
CLIENT_URL=http://localhost:5173      # plusieurs URLs : sépare par virgules

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=senegram

# JWT
JWT_SECRET=remplace-moi-par-une-longue-chaine-aleatoire
JWT_EXPIRES_IN=7d

# Uploads
UPLOAD_DIR=uploads
MAX_UPLOAD_SIZE=52428800              # 50 Mo

# WebRTC TURN (optionnel — utile derrière un NAT strict)
TURN_URL=
TURN_USERNAME=
TURN_PASSWORD=
```

### `frontend/.env` (optionnel)

```env
VITE_API_URL=http://localhost:5000
```

> En LAN, remplace `localhost` par l'IP de la machine qui héberge le backend (ex : `http://192.168.1.42:5000`).

---

## 📱 Utilisation sur mobile (LAN) — HTTPS

Pour **passer des appels depuis un téléphone sur le même Wi-Fi**, le navigateur exige un **contexte sécurisé (HTTPS)** pour accéder à la caméra/micro.

```bash
cd backend
npm run gen-cert            # génère certs/cert.pem + certs/key.pem auto-signés
npm run dev                 # le serveur passe automatiquement en HTTPS
```

Sur le mobile :
1. Ouvre `https://<IP-du-PC>:5000` une fois → accepte l'avertissement de sécurité.
2. Ouvre `https://<IP-du-PC>:5173` → idem.
3. Connecte-toi normalement, les appels fonctionnent. ✨

> 💡 Sur Windows, pense à **autoriser le pare-feu** (scripts `scripts/open-firewall.bat`).

---

## 🌐 API REST

Toutes les routes (sauf `/api/auth/register` et `/api/auth/login`) requièrent un header `Authorization: Bearer <jwt>`.

### Auth
| Méthode | URL                     | Rôle                  |
|---------|-------------------------|-----------------------|
| POST    | `/api/auth/register`    | Inscription           |
| POST    | `/api/auth/login`       | Connexion             |
| GET     | `/api/auth/me`          | Utilisateur courant   |

### Utilisateurs
| Méthode | URL                            | Rôle                       |
|---------|--------------------------------|----------------------------|
| GET     | `/api/users/search?q=`         | Recherche d'utilisateurs   |
| PATCH   | `/api/users/me`                | Mise à jour du profil      |
| POST    | `/api/users/me/password`       | Changement de mot de passe |
| GET     | `/api/users/contacts`          | Liste des contacts         |
| POST    | `/api/users/contacts/:id`      | Ajouter un contact         |

### Conversations & Messages
| Méthode | URL                                       | Rôle                          |
|---------|-------------------------------------------|-------------------------------|
| GET     | `/api/conversations`                      | Liste des discussions         |
| POST    | `/api/conversations/private`              | Ouvrir/Créer un 1-à-1         |
| GET     | `/api/conversations/:id`                  | Détail d'une conversation     |
| POST    | `/api/conversations/:id/read`             | Marquer comme lu              |
| GET     | `/api/messages/conversation/:id`          | Liste des messages            |
| POST    | `/api/messages/conversation/:id`          | Envoyer un message            |
| PATCH   | `/api/messages/:id`                       | Éditer un message             |
| DELETE  | `/api/messages/:id`                       | Supprimer un message          |

### Groupes
| Méthode | URL                                       | Rôle                          |
|---------|-------------------------------------------|-------------------------------|
| POST    | `/api/groups`                             | Créer un groupe               |
| PATCH   | `/api/groups/:id`                         | Modifier (admin)              |
| POST    | `/api/groups/:id/members`                 | Ajouter membre(s)             |
| DELETE  | `/api/groups/:id/members/:userId`         | Retirer un membre             |
| POST    | `/api/groups/:id/leave`                   | Quitter le groupe             |

### Uploads & Appels
| Méthode | URL                              | Rôle                          |
|---------|----------------------------------|-------------------------------|
| POST    | `/api/upload/file`               | Upload d'un fichier (multipart) |
| POST    | `/api/upload/avatar`             | Upload d'un avatar              |
| GET     | `/api/calls/conversation/:id`    | Historique des appels           |

---

## 📡 Événements Socket.IO

Connexion : `io(<API_URL>, { auth: { token: <jwt> } })`

### Client → Serveur

| Événement            | Payload                                              |
|----------------------|------------------------------------------------------|
| `conversation:join`  | `{ conversation_id }`                                |
| `typing`             | `{ conversation_id, is_typing }`                     |
| `message:read`       | `{ conversation_id, message_id }`                    |
| `call:invite`        | `{ conversation_id, to_user_id, type, sdp_offer }`   |
| `call:accept`        | `{ call_id, to_user_id, sdp_answer }`                |
| `call:reject`        | `{ call_id, to_user_id }`                            |
| `call:ice`           | `{ to_user_id, candidate }`                          |
| `call:end`           | `{ call_id, to_user_id, duration }`                  |

### Serveur → Client

| Événement                                 | Utilité                                |
|-------------------------------------------|----------------------------------------|
| `message:new` / `edited` / `deleted`      | Diffusion des messages                 |
| `typing`                                  | Indicateur "est en train d'écrire"     |
| `presence:update`                         | Online / offline                       |
| `call:incoming` / `accepted` / `rejected` | Signaling WebRTC                       |
| `call:ice` / `ended` / `created`          | Échange ICE + cycle de vie de l'appel  |

---

## 🗄️ Schéma de la base de données

8 tables principales :

| Table                  | Rôle                                                    |
|------------------------|---------------------------------------------------------|
| `users`                | Comptes (avec status, last_seen, avatar)                |
| `contacts`             | Carnet d'adresses (avec blocage)                        |
| `conversations`        | 1-à-1 et groupes                                        |
| `conversation_members` | Membres + rôle (`owner` / `admin` / `member`)           |
| `messages`             | Messages texte / fichiers / réponses                    |
| `attachments`          | Métadonnées des pièces jointes                          |
| `calls`                | Historique des appels (audio/vidéo, durée, statut)      |
| `message_reads`        | Indicateurs de lecture par utilisateur                  |

Voir `backend/database/schema.sql` pour le détail (clés étrangères, index, contraintes).

---

## 🧪 Scripts utilitaires (Windows)

Dans `scripts/` :

| Script                   | Action                                              |
|--------------------------|-----------------------------------------------------|
| `01-diagnose.bat`        | Vérifie Node, MySQL, ports                          |
| `02-setup.bat`           | Installe les dépendances back + front               |
| `03-run.bat`             | Lance backend et frontend dans deux terminaux       |
| `04-enable-https.bat`    | Génère les certificats auto-signés (HTTPS LAN)      |
| `import-db.bat`          | Importe `schema.sql` via la CLI MySQL               |
| `open-firewall.bat`      | Ouvre les ports 5000 & 5173 dans le pare-feu Windows|
| `close-firewall.bat`     | Referme les règles                                  |
| `kill-mysql-ghost.bat`   | Tue un process MySQL fantôme qui squatte le port    |

---

## 🧭 Roadmap

- [ ] Appels en groupe (SFU type **mediasoup** ou **LiveKit**)
- [ ] Messages vocaux (MediaRecorder, déjà câblé côté upload)
- [ ] Notifications push navigateur (Web Push API)
- [ ] Chiffrement E2E (protocole Signal)
- [ ] Application mobile (React Native ou Capacitor)
- [ ] Modération & système de signalement
- [ ] Déploiement VPS clé-en-main : **nginx** reverse-proxy + **PM2** + **certbot** + **coturn**
- [ ] Mode sombre 🌙

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Pour proposer une amélioration :

1. Fork le repo
2. Crée une branche : `git checkout -b feat/ma-feature`
3. Commit : `git commit -m "feat: ajout de ma feature"`
4. Push : `git push origin feat/ma-feature`
5. Ouvre une **Pull Request**

Merci de respecter le style de code existant (français pour les commentaires, conventionnel pour les commits).

---

## 📜 Licence

Ce projet est distribué sous licence **MIT**. Tu peux l'utiliser, le modifier et le redistribuer librement.

---

## 👤 Auteur

**realtidiane**

🇸🇳 *Made with **teranga** in Sénégal.*

Si Senegram t'a été utile, n'hésite pas à laisser une ⭐ sur le repo !
