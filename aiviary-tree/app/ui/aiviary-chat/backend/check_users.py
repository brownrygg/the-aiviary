import asyncio
from database import AsyncSessionLocal
from models import User
from sqlalchemy.future import select

async def list_users():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User))
        users = result.scalars().all()
        print(f"Total users: {len(users)}")
        for user in users:
            print(f"User: {user.email}, Role: {user.role}, Active: {user.is_active}")

if __name__ == "__main__":
    asyncio.run(list_users())
