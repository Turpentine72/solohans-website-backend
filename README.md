# Solohans Backend – Express + MongoDB

## Stack
- **Express.js** – REST API
- **MongoDB + Mongoose** – Database
- **JWT** – Admin authentication
- **Cloudinary** – Image/receipt uploads
- **bcryptjs** – Password hashing

## Setup

```bash
cd backend
npm install
cp .env.example .env   # fill in your values
npm run dev
```

## Environment Variables (.env)
| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Secret key for JWT signing |
| `JWT_EXPIRES_IN` | Token expiry e.g. `7d` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `PAYSTACK_SECRET_KEY` | Paystack secret (for server-side verification) |
| `CLIENT_URL` | Frontend URL for CORS e.g. `https://solohansmeals.com` |
| `PORT` | Server port (default 5000) |

## API Routes

### Auth
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Admin login |
| POST | `/api/auth/forgot-password` | No | Request password reset |

### Menu Items
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/menu-items` | No | List all (supports `?available=true&signature=true&limit=6`) |
| POST | `/api/menu-items` | ✅ | Create item |
| PUT | `/api/menu-items/:id` | ✅ | Update item |
| DELETE | `/api/menu-items/:id` | ✅ | Delete item |

### Categories
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/categories` | No | List all |
| POST | `/api/categories` | ✅ | Create |
| PUT | `/api/categories/:id` | ✅ | Update |
| DELETE | `/api/categories/:id` | ✅ | Delete |

### Orders
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/orders` | No | Create order (from checkout) |
| GET | `/api/orders` | ✅ | List all orders |
| GET | `/api/orders/:id` | ✅ | Get one order |
| PATCH | `/api/orders/:id/status` | ✅ | Update order/payment status |

### Contacts
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/contacts` | No | Submit contact form |
| GET | `/api/contacts` | ✅ | List all messages |
| PATCH | `/api/contacts/:id/reply` | ✅ | Reply to message |

### Reviews
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/reviews` | No | List reviews (supports `?status=Approved`) |
| POST | `/api/reviews` | No | Submit review |
| PATCH | `/api/reviews/:id/status` | ✅ | Approve / Hide |
| PATCH | `/api/reviews/:id/featured` | ✅ | Toggle featured |
| PATCH | `/api/reviews/:id/reply` | ✅ | Add reply |
| DELETE | `/api/reviews/:id` | ✅ | Delete |

### Upload
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/upload` | ✅ | Upload file to Cloudinary, returns `{ url }` |

## Creating the first admin user
```js
// Run once in a script or via MongoDB Compass:
db.users.insertOne({
  email: "admin@solohansmeals.com",
  password: "$2b$12$...", // bcrypt hash of your password
  role: "admin"
})
```
Or add a seed route temporarily to `server.js`.
