import asyncio
import sys
from database import AsyncSessionLocal
from models import User
from sqlalchemy.future import select
from auth import hash_password

async def reset_password(email, new_password):
    print(f"Resetting password for {email}...")
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalars().one_or_none()
        
        if not user:
            print(f"User {email} not found!")
            sys.exit(1)
            
        user.password_hash = hash_password(new_password)
        db.add(user)
        await db.commit()
        print(f"Password reset successfully for {email}")

if __name__ == "__main__":
    asyncio.run(reset_password("test@example.com", "Test1234"))
