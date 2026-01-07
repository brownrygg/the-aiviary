"""
Quick setup verification script.

Tests:
- Database connection
- Password hashing
- JWT token creation/verification
- Environment variables

Usage:
    python test_setup.py
"""

import asyncio
import os
import sys


def check_environment():
    """Check required environment variables."""
    print("\n=== Checking Environment Variables ===")

    required_vars = {
        "DATABASE_URL": "Database connection string",
        "JWT_SECRET_KEY": "JWT secret key",
    }

    optional_vars = {
        "ENVIRONMENT": "Environment (development/production)",
        "ALLOWED_ORIGINS": "CORS allowed origins",
    }

    missing = []

    for var, description in required_vars.items():
        value = os.getenv(var)
        if value:
            # Don't show full value for secrets
            if "SECRET" in var or "PASSWORD" in var:
                display_value = value[:10] + "..." if len(value) > 10 else "***"
            else:
                display_value = value[:50] + "..." if len(value) > 50 else value
            print(f"✓ {var}: {display_value}")
        else:
            print(f"✗ {var}: MISSING")
            missing.append(var)

    print("\nOptional variables:")
    for var, description in optional_vars.items():
        value = os.getenv(var)
        if value:
            print(f"✓ {var}: {value}")
        else:
            print(f"  {var}: Not set (using defaults)")

    if missing:
        print(f"\n❌ Missing required variables: {', '.join(missing)}")
        print("Please copy .env.example to .env and configure it.")
        return False

    print("\n✓ All required environment variables are set")
    return True


def check_imports():
    """Check if all required packages are installed."""
    print("\n=== Checking Package Imports ===")

    packages = {
        "fastapi": "FastAPI",
        "sqlalchemy": "SQLAlchemy",
        "jose": "python-jose (JWT)",
        "passlib": "passlib (password hashing)",
        "pydantic": "Pydantic",
        "uvicorn": "Uvicorn",
        "asyncpg": "asyncpg (PostgreSQL driver)",
    }

    all_ok = True

    for package, description in packages.items():
        try:
            __import__(package)
            print(f"✓ {description}")
        except ImportError:
            print(f"✗ {description} - NOT INSTALLED")
            all_ok = False

    if not all_ok:
        print("\n❌ Some packages are missing")
        print("Run: pip install -r requirements.txt")
        return False

    print("\n✓ All required packages are installed")
    return True


async def check_database():
    """Check database connection."""
    print("\n=== Checking Database Connection ===")

    try:
        from database import get_db, init_db

        # Try to connect
        async for db in get_db():
            # Execute simple query
            result = await db.execute("SELECT 1")
            print("✓ Database connection successful")

            # Try to initialize tables
            try:
                await init_db()
                print("✓ Database tables initialized/verified")
            except Exception as e:
                print(f"⚠ Table initialization warning: {e}")
                print("  (This is normal if tables already exist)")

            return True

    except Exception as e:
        print(f"✗ Database connection failed: {e}")
        print("\nTroubleshooting:")
        print("1. Ensure PostgreSQL is running")
        print("2. Check DATABASE_URL in .env file")
        print("3. Verify database exists and user has permissions")
        return False


def check_password_hashing():
    """Test password hashing functionality."""
    print("\n=== Testing Password Hashing ===")

    try:
        from auth import hash_password, verify_password

        # Test password
        test_password = "TestPassword123"

        # Hash password
        hashed = hash_password(test_password)
        print(f"✓ Password hashing works")
        print(f"  Sample hash: {hashed[:50]}...")

        # Verify password
        if verify_password(test_password, hashed):
            print("✓ Password verification works")
        else:
            print("✗ Password verification failed")
            return False

        # Verify wrong password fails
        if not verify_password("WrongPassword123", hashed):
            print("✓ Wrong password correctly rejected")
        else:
            print("✗ Wrong password incorrectly accepted")
            return False

        return True

    except Exception as e:
        print(f"✗ Password hashing test failed: {e}")
        return False


def check_jwt():
    """Test JWT token creation and verification."""
    print("\n=== Testing JWT Tokens ===")

    try:
        from auth import create_access_token, decode_token

        # Test data
        test_data = {"sub": "123", "email": "test@example.com"}

        # Create token
        token = create_access_token(test_data)
        print("✓ JWT token creation works")
        print(f"  Sample token: {token[:50]}...")

        # Decode token
        decoded = decode_token(token)
        if decoded["sub"] == "123" and decoded["email"] == "test@example.com":
            print("✓ JWT token verification works")
            print(f"  Decoded data: sub={decoded['sub']}, email={decoded['email']}")
        else:
            print("✗ JWT token verification failed - data mismatch")
            return False

        return True

    except Exception as e:
        print(f"✗ JWT test failed: {e}")
        return False


async def run_all_checks():
    """Run all verification checks."""
    print("=" * 60)
    print("FastAPI Authentication System - Setup Verification")
    print("=" * 60)

    results = []

    # Check environment
    results.append(("Environment Variables", check_environment()))

    # Check imports
    if results[-1][1]:  # Only continue if env vars are set
        results.append(("Package Imports", check_imports()))

        if results[-1][1]:  # Only continue if packages are installed
            results.append(("Database Connection", await check_database()))
            results.append(("Password Hashing", check_password_hashing()))
            results.append(("JWT Tokens", check_jwt()))

    # Summary
    print("\n" + "=" * 60)
    print("VERIFICATION SUMMARY")
    print("=" * 60)

    all_passed = True
    for check_name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"{status}: {check_name}")
        if not passed:
            all_passed = False

    print("=" * 60)

    if all_passed:
        print("\n🎉 All checks passed! Your setup is ready.")
        print("\nNext steps:")
        print("1. Create a superuser: python create_superuser.py")
        print("2. Start the server: uvicorn main:app --reload")
        print("3. Visit API docs: http://localhost:8000/docs")
        print()
    else:
        print("\n❌ Some checks failed. Please fix the issues above.")
        print()
        sys.exit(1)


if __name__ == "__main__":
    try:
        # Load environment variables
        try:
            from dotenv import load_dotenv
            load_dotenv()
            print("Loaded .env file")
        except ImportError:
            print("python-dotenv not installed (optional)")
        except Exception:
            print("No .env file found (using environment variables)")

        # Run checks
        asyncio.run(run_all_checks())

    except KeyboardInterrupt:
        print("\n\nVerification cancelled.\n")
        sys.exit(0)
    except Exception as e:
        print(f"\n\n❌ Unexpected error: {e}\n")
        sys.exit(1)
