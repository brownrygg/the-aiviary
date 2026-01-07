"""
Utility script to create a superuser account.

Usage:
    python create_superuser.py

This script creates an admin user for initial system setup.
"""

import asyncio
import sys
from getpass import getpass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from database import AsyncSessionLocal, init_db
from models import User, Team
from auth import hash_password


async def create_superuser():
    """Create a superuser account interactively."""

    print("\n=== Create Superuser Account ===\n")

    # Initialize database
    print("Initializing database...")
    await init_db()
    print("Database initialized.\n")

    # Get user input
    email = input("Email address: ").strip().lower()

    if not email:
        print("Error: Email is required")
        return

    # Get password with confirmation
    while True:
        password = getpass("Password (min 8 chars, uppercase, lowercase, number): ")

        if len(password) < 8:
            print("Error: Password must be at least 8 characters")
            continue

        if not any(c.isupper() for c in password):
            print("Error: Password must contain at least one uppercase letter")
            continue

        if not any(c.islower() for c in password):
            print("Error: Password must contain at least one lowercase letter")
            continue

        if not any(c.isdigit() for c in password):
            print("Error: Password must contain at least one number")
            continue

        password_confirm = getpass("Confirm password: ")

        if password != password_confirm:
            print("Error: Passwords do not match")
            continue

        break

    full_name = input("Full name (optional): ").strip() or None

    # Create user
    async with AsyncSessionLocal() as db:
        try:
            # Check if user already exists
            result = await db.execute(select(User).where(User.email == email))
            existing_user = result.scalar_one_or_none()

            if existing_user:
                print(f"\nError: User with email {email} already exists")
                # Even if user exists, check/fix role if needed? No, just exit for now.
                return

            # Ensure a team exists
            print("Checking for existing team...")
            result = await db.execute(select(Team).limit(1))
            team = result.scalar_one_or_none()

            if not team:
                print("No team found. Creating default 'Admin Team'...")
                team = Team(
                    name="Admin Team",
                    slug="admin-team",
                    is_active=True
                )
                db.add(team)
                await db.commit()
                await db.refresh(team)
                print(f"Created team: {team.name} (ID: {team.id})")
            else:
                print(f"Using existing team: {team.name}")

            # Create superuser
            hashed_password = hash_password(password)

            superuser = User(
                email=email,
                password_hash=hashed_password,  # Fixed field name
                full_name=full_name,
                is_active=True,
                role="admin",  # Fixed: use role instead of is_superuser
                team_id=team.id # Fixed: assign team_id
            )

            db.add(superuser)
            await db.commit()
            await db.refresh(superuser)

            print(f"\n✓ Superuser created successfully!")
            print(f"  ID: {superuser.id}")
            print(f"  Email: {superuser.email}")
            print(f"  Name: {superuser.full_name or 'N/A'}")
            print(f"  Role: {superuser.role}")
            print(f"  Team: {team.name}")
            print(f"\nYou can now log in with these credentials.\n")

        except Exception as e:
            await db.rollback()
            print(f"\nError creating superuser: {e}\n")
            # Print full trace for debugging if needed
            import traceback
            traceback.print_exc()
            sys.exit(1)


if __name__ == "__main__":
    try:
        asyncio.run(create_superuser())
    except KeyboardInterrupt:
        print("\n\nOperation cancelled.\n")
        sys.exit(0)
