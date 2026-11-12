import uuid
from datetime import datetime

from pydantic import EmailStr, Field, field_validator

from app.schemas.common import ORMModel

PASSWORD_MIN = 12
PASSWORD_MAX = 256  # Argon2 handles long inputs; cap to bound hashing cost per request.


class RegisterRequest(ORMModel):
    email: EmailStr
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    display_name: str = Field(min_length=1, max_length=120)

    @field_validator("display_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("password")
    @classmethod
    def _strength(cls, v: str) -> str:
        if v.strip() != v or len(set(v)) < 6:
            raise ValueError("choose a stronger password (no surrounding spaces, more varied characters)")
        return v


class LoginRequest(ORMModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)


class UserRead(ORMModel):
    id: uuid.UUID
    email: str
    display_name: str
    created_at: datetime


class TokenResponse(ORMModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead
