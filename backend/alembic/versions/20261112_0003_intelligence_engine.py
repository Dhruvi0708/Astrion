"""intelligence engine

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-12 10:15:29.315579

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '0003'
down_revision: Union[str, None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('graph_changes',
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('investigation_id', sa.Uuid(), nullable=True),
    sa.Column('change_type', sa.Enum('entity_created', 'entity_updated', 'entity_merged', 'relationship_created', 'relationship_reinforced', 'claim_added', 'contradiction_linked', 'hypothesis_added', name='graph_change_type', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('target_key', sa.String(length=128), nullable=False),
    sa.Column('details', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['investigation_id'], ['investigations.id'], name=op.f('fk_graph_changes_investigation_id_investigations'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_graph_changes_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_graph_changes'))
    )
    op.create_index('ix_graph_changes_investigation_created', 'graph_changes', ['investigation_id', 'created_at'], unique=False)
    op.create_index(op.f('ix_graph_changes_workspace_id'), 'graph_changes', ['workspace_id'], unique=False)
    op.create_table('document_chunks',
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('document_id', sa.Uuid(), nullable=False),
    sa.Column('chunk_index', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('char_start', sa.Integer(), nullable=False),
    sa.Column('char_end', sa.Integer(), nullable=False),
    sa.Column('page', sa.Integer(), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('char_end >= char_start', name=op.f('ck_document_chunks_span_ordered')),
    sa.ForeignKeyConstraint(['document_id'], ['documents.id'], name=op.f('fk_document_chunks_document_id_documents'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_document_chunks_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_document_chunks')),
    sa.UniqueConstraint('document_id', 'chunk_index', name='uq_document_chunks_position')
    )
    op.create_index(op.f('ix_document_chunks_document_id'), 'document_chunks', ['document_id'], unique=False)
    op.create_table('investigation_reports',
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('investigation_id', sa.Uuid(), nullable=False),
    sa.Column('execution_id', sa.Uuid(), nullable=True),
    sa.Column('run_number', sa.Integer(), nullable=False),
    sa.Column('content', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('provider', sa.String(length=32), nullable=True),
    sa.Column('model', sa.String(length=120), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['execution_id'], ['agent_executions.id'], name=op.f('fk_investigation_reports_execution_id_agent_executions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['investigation_id'], ['investigations.id'], name=op.f('fk_investigation_reports_investigation_id_investigations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_investigation_reports_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_investigation_reports')),
    sa.UniqueConstraint('investigation_id', 'run_number', name='uq_investigation_reports_run')
    )
    op.create_index(op.f('ix_investigation_reports_investigation_id'), 'investigation_reports', ['investigation_id'], unique=False)
    op.create_table('verification_results',
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('investigation_id', sa.Uuid(), nullable=False),
    sa.Column('execution_id', sa.Uuid(), nullable=True),
    sa.Column('target_type', sa.String(length=32), nullable=False),
    sa.Column('target_id', sa.Uuid(), nullable=False),
    sa.Column('verdict', sa.Enum('supported', 'partially_supported', 'unsupported', 'insufficient_evidence', 'contradicted', name='verification_verdict', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('reasoning', sa.Text(), nullable=False),
    sa.Column('issues', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('missing_evidence', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('checked_claim_ids', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['execution_id'], ['agent_executions.id'], name=op.f('fk_verification_results_execution_id_agent_executions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['investigation_id'], ['investigations.id'], name=op.f('fk_verification_results_investigation_id_investigations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_verification_results_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_verification_results'))
    )
    op.create_index(op.f('ix_verification_results_investigation_id'), 'verification_results', ['investigation_id'], unique=False)
    op.create_index('ix_verification_results_target', 'verification_results', ['target_type', 'target_id'], unique=False)
    op.create_table('contradictions',
    sa.Column('workspace_id', sa.Uuid(), nullable=False),
    sa.Column('investigation_id', sa.Uuid(), nullable=False),
    sa.Column('execution_id', sa.Uuid(), nullable=True),
    sa.Column('claim_a_id', sa.Uuid(), nullable=False),
    sa.Column('claim_b_id', sa.Uuid(), nullable=False),
    sa.Column('kind', sa.Enum('direct', 'temporal', 'contextual', name='contradiction_kind', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('is_genuine', sa.Boolean(), nullable=False),
    sa.Column('explanation', sa.Text(), nullable=False),
    sa.Column('severity', sa.String(length=16), nullable=False),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('claim_a_id <> claim_b_id', name=op.f('ck_contradictions_distinct_claims')),
    sa.ForeignKeyConstraint(['claim_a_id'], ['claims.id'], name=op.f('fk_contradictions_claim_a_id_claims'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['claim_b_id'], ['claims.id'], name=op.f('fk_contradictions_claim_b_id_claims'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['execution_id'], ['agent_executions.id'], name=op.f('fk_contradictions_execution_id_agent_executions'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['investigation_id'], ['investigations.id'], name=op.f('fk_contradictions_investigation_id_investigations'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_contradictions_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_contradictions')),
    sa.UniqueConstraint('investigation_id', 'claim_a_id', 'claim_b_id', name='uq_contradictions_pair')
    )
    op.create_index(op.f('ix_contradictions_investigation_id'), 'contradictions', ['investigation_id'], unique=False)
    op.create_index('ix_contradictions_workspace', 'contradictions', ['workspace_id'], unique=False)
    op.create_table('relationship_claims',
    sa.Column('relationship_id', sa.Uuid(), nullable=False),
    sa.Column('claim_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['claim_id'], ['claims.id'], name=op.f('fk_relationship_claims_claim_id_claims'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['relationship_id'], ['graph_relationships.id'], name=op.f('fk_relationship_claims_relationship_id_graph_relationships'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('relationship_id', 'claim_id', name=op.f('pk_relationship_claims'))
    )
    op.create_table('investigation_claims',
    sa.Column('investigation_id', sa.Uuid(), nullable=False),
    sa.Column('claim_id', sa.Uuid(), nullable=False),
    sa.ForeignKeyConstraint(['claim_id'], ['claims.id'], name=op.f('fk_investigation_claims_claim_id_claims'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['investigation_id'], ['investigations.id'], name=op.f('fk_investigation_claims_investigation_id_investigations'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('investigation_id', 'claim_id', name=op.f('pk_investigation_claims'))
    )
    op.create_index(op.f('ix_investigation_claims_claim_id'), 'investigation_claims', ['claim_id'], unique=False)
    op.add_column('agent_executions', sa.Column('step_key', sa.String(length=120), nullable=True))
    op.add_column('agent_executions', sa.Column('attempt', sa.Integer(), nullable=False, server_default=sa.text('1')))
    op.add_column('agent_executions', sa.Column('depends_on', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False, server_default=sa.text("'[]'")))
    op.add_column('agent_executions', sa.Column('duration_ms', sa.Integer(), nullable=True))
    op.add_column('agent_executions', sa.Column('cost_usd', sa.Float(), nullable=True))
    op.add_column('agent_executions', sa.Column('summary', sa.Text(), nullable=True))
    op.create_unique_constraint('uq_agent_executions_step_attempt', 'agent_executions', ['investigation_id', 'step_key', 'attempt'])
    op.add_column('claims', sa.Column('kind', sa.Enum('explicit', 'inferred', name='claim_kind', native_enum=False, create_constraint=True, length=32), nullable=False, server_default=sa.text("'explicit'")))
    op.add_column('claims', sa.Column('investigation_id', sa.Uuid(), nullable=True))
    op.add_column('claims', sa.Column('extraction_execution_id', sa.Uuid(), nullable=True))
    op.add_column('claims', sa.Column('subject_entity_id', sa.Uuid(), nullable=True))
    op.add_column('claims', sa.Column('temporal_scope', sa.String(length=120), nullable=True))
    op.add_column('claims', sa.Column('normalized_statement', sa.String(length=600), nullable=True))
    op.add_column('claims', sa.Column('graph_synced_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f('ix_claims_investigation_id'), 'claims', ['investigation_id'], unique=False)
    op.create_index(op.f('ix_claims_normalized_statement'), 'claims', ['normalized_statement'], unique=False)
    op.create_foreign_key(op.f('fk_claims_extraction_execution_id_agent_executions'), 'claims', 'agent_executions', ['extraction_execution_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key(op.f('fk_claims_investigation_id_investigations'), 'claims', 'investigations', ['investigation_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key(op.f('fk_claims_subject_entity_id_graph_entities'), 'claims', 'graph_entities', ['subject_entity_id'], ['id'], ondelete='SET NULL')
    op.add_column('graph_entities', sa.Column('normalized_name', sa.String(length=500), nullable=True))
    op.add_column('graph_entities', sa.Column('aliases', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False, server_default=sa.text("'[]'")))
    op.add_column('graph_entities', sa.Column('mention_count', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('graph_entities', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('graph_entities', sa.Column('graph_synced_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('uq_graph_entities_dedup', 'graph_entities', ['workspace_id', 'entity_type', 'normalized_name'])
    op.add_column('graph_relationships', sa.Column('support_count', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('graph_relationships', sa.Column('first_seen_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('graph_relationships', sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('graph_relationships', sa.Column('graph_synced_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('uq_graph_relationships_triple', 'graph_relationships', ['workspace_id', 'source_entity_id', 'target_entity_id', 'relation_type'])
    op.add_column('hypotheses', sa.Column('confidence_method', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False, server_default=sa.text("'{}'")))
    op.add_column('hypotheses', sa.Column('test_plan', sa.Text(), nullable=True))
    op.add_column('investigations', sa.Column('document_ids', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=False, server_default=sa.text("'[]'")))
    op.add_column('investigations', sa.Column('plan', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'), nullable=True))
    op.add_column('investigations', sa.Column('cancel_requested', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('investigations', sa.Column('run_count', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('investigations', sa.Column('error', sa.Text(), nullable=True))
    op.add_column('investigations', sa.Column('started_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('investigations', sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('investigations', sa.Column('llm_provider', sa.String(length=32), nullable=True))
    op.add_column('investigations', sa.Column('llm_model', sa.String(length=120), nullable=True))
    op.add_column('investigations', sa.Column('input_tokens', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('investigations', sa.Column('output_tokens', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.add_column('investigations', sa.Column('cost_usd', sa.Float(), nullable=False, server_default=sa.text('0')))

    # ---- enum vocabularies (non-native enums are CHECK constraints) ----
    op.execute("UPDATE investigations SET status = 'draft' WHERE status IN ('active', 'paused', 'closed')")
    op.drop_constraint(op.f("ck_investigations_investigation_status"), "investigations", type_="check")
    op.create_check_constraint(
        op.f("ck_investigations_investigation_status"),
        "investigations",
        "status IN ('draft', 'queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled', 'interrupted')",
    )
    op.execute(
        "UPDATE agent_executions SET agent_role = 'system' "
        "WHERE agent_role IN ('inquirer', 'cartographer', 'retriever', 'skeptic', 'verifier')"
    )
    op.drop_constraint(op.f("ck_agent_executions_agent_role"), "agent_executions", type_="check")
    op.create_check_constraint(
        op.f("ck_agent_executions_agent_role"),
        "agent_executions",
        "agent_role IN ('system', 'orchestrator', 'research', 'knowledge', 'hypothesis', 'contradiction', 'verification', 'synthesis')",
    )
    op.drop_constraint(op.f("ck_agent_executions_execution_status"), "agent_executions", type_="check")
    op.create_check_constraint(
        op.f("ck_agent_executions_execution_status"),
        "agent_executions",
        "status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')",
    )


def downgrade() -> None:
    op.execute("UPDATE agent_executions SET status = 'cancelled' WHERE status = 'skipped'")
    op.drop_constraint(op.f("ck_agent_executions_execution_status"), "agent_executions", type_="check")
    op.create_check_constraint(
        op.f("ck_agent_executions_execution_status"), "agent_executions", "status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')"
    )
    op.execute("DELETE FROM agent_executions WHERE agent_role NOT IN ('inquirer', 'cartographer', 'retriever', 'skeptic', 'verifier')")
    op.drop_constraint(op.f("ck_agent_executions_agent_role"), "agent_executions", type_="check")
    op.create_check_constraint(
        op.f("ck_agent_executions_agent_role"), "agent_executions", "agent_role IN ('inquirer', 'cartographer', 'retriever', 'skeptic', 'verifier')"
    )
    op.execute("UPDATE investigations SET status = 'draft' WHERE status NOT IN ('draft', 'active', 'paused', 'closed')")
    op.drop_constraint(op.f("ck_investigations_investigation_status"), "investigations", type_="check")
    op.create_check_constraint(
        op.f("ck_investigations_investigation_status"), "investigations", "status IN ('draft', 'active', 'paused', 'closed')"
    )
    op.drop_column('investigations', 'cost_usd')
    op.drop_column('investigations', 'output_tokens')
    op.drop_column('investigations', 'input_tokens')
    op.drop_column('investigations', 'llm_model')
    op.drop_column('investigations', 'llm_provider')
    op.drop_column('investigations', 'finished_at')
    op.drop_column('investigations', 'started_at')
    op.drop_column('investigations', 'error')
    op.drop_column('investigations', 'run_count')
    op.drop_column('investigations', 'cancel_requested')
    op.drop_column('investigations', 'plan')
    op.drop_column('investigations', 'document_ids')
    op.drop_column('hypotheses', 'test_plan')
    op.drop_column('hypotheses', 'confidence_method')
    op.drop_constraint('uq_graph_relationships_triple', 'graph_relationships', type_='unique')
    op.drop_column('graph_relationships', 'graph_synced_at')
    op.drop_column('graph_relationships', 'last_seen_at')
    op.drop_column('graph_relationships', 'first_seen_at')
    op.drop_column('graph_relationships', 'support_count')
    op.drop_constraint('uq_graph_entities_dedup', 'graph_entities', type_='unique')
    op.drop_column('graph_entities', 'graph_synced_at')
    op.drop_column('graph_entities', 'last_seen_at')
    op.drop_column('graph_entities', 'mention_count')
    op.drop_column('graph_entities', 'aliases')
    op.drop_column('graph_entities', 'normalized_name')
    op.drop_constraint(op.f('fk_claims_subject_entity_id_graph_entities'), 'claims', type_='foreignkey')
    op.drop_constraint(op.f('fk_claims_investigation_id_investigations'), 'claims', type_='foreignkey')
    op.drop_constraint(op.f('fk_claims_extraction_execution_id_agent_executions'), 'claims', type_='foreignkey')
    op.drop_index(op.f('ix_claims_normalized_statement'), table_name='claims')
    op.drop_index(op.f('ix_claims_investigation_id'), table_name='claims')
    op.drop_column('claims', 'graph_synced_at')
    op.drop_column('claims', 'normalized_statement')
    op.drop_column('claims', 'temporal_scope')
    op.drop_column('claims', 'subject_entity_id')
    op.drop_column('claims', 'extraction_execution_id')
    op.drop_column('claims', 'investigation_id')
    op.drop_column('claims', 'kind')
    op.drop_constraint('uq_agent_executions_step_attempt', 'agent_executions', type_='unique')
    op.drop_column('agent_executions', 'summary')
    op.drop_column('agent_executions', 'cost_usd')
    op.drop_column('agent_executions', 'duration_ms')
    op.drop_column('agent_executions', 'depends_on')
    op.drop_column('agent_executions', 'attempt')
    op.drop_column('agent_executions', 'step_key')
    op.drop_index(op.f('ix_investigation_claims_claim_id'), table_name='investigation_claims')
    op.drop_table('investigation_claims')
    op.drop_table('relationship_claims')
    op.drop_index('ix_contradictions_workspace', table_name='contradictions')
    op.drop_index(op.f('ix_contradictions_investigation_id'), table_name='contradictions')
    op.drop_table('contradictions')
    op.drop_index('ix_verification_results_target', table_name='verification_results')
    op.drop_index(op.f('ix_verification_results_investigation_id'), table_name='verification_results')
    op.drop_table('verification_results')
    op.drop_index(op.f('ix_investigation_reports_investigation_id'), table_name='investigation_reports')
    op.drop_table('investigation_reports')
    op.drop_index(op.f('ix_document_chunks_document_id'), table_name='document_chunks')
    op.drop_table('document_chunks')
    op.drop_index(op.f('ix_graph_changes_workspace_id'), table_name='graph_changes')
    op.drop_index('ix_graph_changes_investigation_created', table_name='graph_changes')
    op.drop_table('graph_changes')
