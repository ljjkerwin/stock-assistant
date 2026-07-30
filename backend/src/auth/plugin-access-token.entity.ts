import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('plugin_access_tokens')
export class PluginAccessToken {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Column()
  name: string;

  @Index()
  @Column()
  userId: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  revokedAt: Date | null;
}
