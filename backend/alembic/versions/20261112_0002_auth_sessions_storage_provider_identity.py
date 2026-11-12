"""auth sessions storage provider identity

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-12 09:00:19.103835

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0002'
down_revision: Union[str, None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('auth_sessions',
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('family_id', sa.Uuid(), nullable=False),
    sa.Column('refresh_token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('revoked_reason', sa.String(length=32), nullable=True),
    sa.Column('replaced_by_id', sa.Uuid(), nullable=True),
    sa.Column('user_agent', sa.String(length=400), nullable=True),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['replaced_by_id'], ['auth_sessions.id'], name=op.f('fk_auth_sessions_replaced_by_id_auth_sessions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_auth_sessions_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_auth_sessions')),
    sa.UniqueConstraint('refresh_token_hash', name=op.f('uq_auth_sessions_refresh_token_hash'))
    )
    op.create_index(op.f('ix_auth_sessions_family_id'), 'auth_sessions', ['family_id'], unique=False)
    op.create_index('ix_auth_sessions_user_active', 'auth_sessions', ['user_id', 'revoked_at'], unique=False)
    op.add_column('agent_executions', sa.Column('provider', sa.String(length=32), nullable=True))
    op.add_column('agent_executions', sa.Column('model_requested', sa.String(length=120), nullable=True))
    op.add_column('agent_executions', sa.Column('fallback_reason', sa.String(length=120), nullable=True))
    op.add_column('agent_executions', sa.Column('provider_request_id', sa.String(length=120), nullable=True))
    op.add_column('documents', sa.Column('storage_backend', sa.String(length=16), nullable=True))
    op.add_column('documents', sa.Column('storage_key', sa.String(length=512), nullable=True))
    op.add_column('documents', sa.Column('original_filename', sa.String(length=255), nullable=True))
    op.create_unique_constraint(op.f('uq_documents_storage_key'), 'documents', ['storage_key'])
    op.add_column('users', sa.Column('password_hash', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True))
    # Emails are compared case-insensitively from now on; normalise any existing rows.
    op.execute("UPDATE users SET email = lower(email) WHERE email <> lower(email)")
    op.drop_constraint('uq_workspaces_slug', 'workspaces', type_='unique')
    op.create_unique_constraint('uq_workspaces_owner_slug', 'workspaces', ['owner_id', 'slug'])


def downgrade() -> None:
    op.drop_constraint('uq_workspaces_owner_slug', 'workspaces', type_='unique')
    # NOTE: fails if two owners created workspaces with the same slug after this upgrade.
    op.create_unique_constraint('uq_workspaces_slug', 'workspaces', ['slug'])
    op.drop_column('users', 'last_login_at')
    op.drop_column('users', 'password_hash')
    op.drop_constraint(op.f('uq_documents_storage_key'), 'documents', type_='unique')
    op.drop_column('documents', 'original_filename')
    op.drop_column('documents', 'storage_key')
    op.drop_column('documents', 'storage_backend')
    op.drop_column('agent_executions', 'provider_request_id')
    op.drop_column('agent_executions', 'fallback_reason')
    op.drop_column('agent_executions', 'model_requested')
    op.drop_column('agent_executions', 'provider')
    op.drop_index('ix_auth_sessions_user_active', table_name='auth_sessions')
    op.drop_index(op.f('ix_auth_sessions_family_id'), table_name='auth_sessions')
    op.drop_table('auth_sessions')
