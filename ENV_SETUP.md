# Environment Variables Setup

Create a `.env` file in the root directory with the following variables:

```env
# MongoDB Connection
# Format: mongodb://localhost:27017/visiondb
# Or: mongodb+srv://username:password@cluster.mongodb.net/visiondb
MONGO_URI=mongodb://localhost:27017/visiondb

# Redis Connection
# Format: redis://localhost:6379
# Or: redis://:password@host:port
REDIS_URL=redis://localhost:6379

# Storage Mode: 'local' or 'azure' (currently only 'local' is implemented)
STORAGE_MODE=local

# Server Port
PORT=3000
```

## Quick Setup

**Windows PowerShell:**
```powershell
@"
MONGO_URI=mongodb://localhost:27017/visiondb
REDIS_URL=redis://localhost:6379
STORAGE_MODE=local
PORT=3000
"@ | Out-File -FilePath .env -Encoding utf8
```

**Linux/Mac:**
```bash
cat > .env << EOF
MONGO_URI=mongodb://localhost:27017/visiondb
REDIS_URL=redis://localhost:6379
STORAGE_MODE=local
PORT=3000
EOF
```

## Notes

- **Never commit `.env` to git** - it's already in `.gitignore`
- Use placeholder values for development
- For production, use secure connection strings with passwords
- MongoDB Atlas users: Get connection string from Atlas dashboard
- Redis Cloud users: Get connection string from Redis Cloud dashboard

