/** 履约库。身份缓存只在改实例的事务里回写。过期 VIP、服务库、处理中都是查询。 */

export const DROP_SCHEMA_SQL = `
SET FOREIGN_KEY_CHECKS = 0;
DROP TRIGGER IF EXISTS members_identity_cache_guard;
DROP TABLE IF EXISTS deal_assignments;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS close_vip_contract;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS meetings;
DROP TABLE IF EXISTS recommendations;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS service_instances;
DROP TABLE IF EXISTS service_ownerships;
DROP TABLE IF EXISTS shop_roles;
DROP TABLE IF EXISTS order_facts;
DROP TABLE IF EXISTS tenant_settings;
DROP TABLE IF EXISTS ai_invocations;
DROP TABLE IF EXISTS member_profiles;
DROP TABLE IF EXISTS members;
DROP TABLE IF EXISTS write_guard;
SET FOREIGN_KEY_CHECKS = 1;
`;

export const SCHEMA_SQL = `
CREATE TABLE write_guard (
  id INT PRIMARY KEY,
  allow_identity_cache INT NOT NULL DEFAULT 0,
  CHECK (id = 1),
  CHECK (allow_identity_cache IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO write_guard (id, allow_identity_cache) VALUES (1, 0);

CREATE TABLE members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  shop_id INT NOT NULL,
  maturity VARCHAR(32) NULL,
  member_type VARCHAR(32) NOT NULL DEFAULT '普通',
  created_at VARCHAR(32) NOT NULL,
  CHECK (maturity IS NULL OR maturity IN ('新升级', '暂停', '已关单')),
  CHECK (member_type IN ('普通', 'VIP', '暂停', '待开启', '过期 VIP', '退费'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TRIGGER members_identity_cache_guard
BEFORE UPDATE ON members
FOR EACH ROW
BEGIN
  IF NEW.member_type <> OLD.member_type THEN
    IF (SELECT allow_identity_cache FROM write_guard WHERE id = 1) <> 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '身份缓存只能由实例事务回写';
    END IF;
  END IF;
END;

CREATE TABLE tenant_settings (
  tenant_id INT PRIMARY KEY,
  auto_start_service INT NOT NULL DEFAULT 1,
  auto_draft_close_on_in_love INT NOT NULL DEFAULT 0,
  compat_clear_deal_ownership INT NOT NULL DEFAULT 1,
  CHECK (auto_start_service IN (0, 1)),
  CHECK (auto_draft_close_on_in_love IN (0, 1)),
  CHECK (compat_clear_deal_ownership IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_facts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  shop_id INT NOT NULL,
  member_id INT NOT NULL,
  order_time VARCHAR(64) NOT NULL,
  payment_status VARCHAR(16) NOT NULL,
  contract_check_status INT NOT NULL,
  duration_months INT NOT NULL,
  planned_start VARCHAR(32) NOT NULL,
  activity_total INT NOT NULL DEFAULT 0,
  emotion_total INT NOT NULL DEFAULT 0,
  one_on_one_total INT NOT NULL DEFAULT 0,
  image_total INT NOT NULL DEFAULT 0,
  refund_status VARCHAR(16) NOT NULL DEFAULT 'none',
  CHECK (payment_status IN ('unpaid', 'payable', 'paid')),
  CHECK (duration_months > 0),
  CHECK (activity_total >= 0),
  CHECK (emotion_total >= 0),
  CHECK (one_on_one_total >= 0),
  CHECK (image_total >= 0),
  CHECK (refund_status IN ('none', 'completed')),
  FOREIGN KEY (member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE shop_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  shop_id INT NOT NULL,
  person_id INT NOT NULL,
  role VARCHAR(32) NOT NULL,
  CHECK (role IN ('matchmanager', 'shop_manager', 'director')),
  UNIQUE (shop_id, person_id, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE service_ownerships (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  shop_id INT NOT NULL,
  member_id INT NOT NULL,
  order_id INT NULL,
  service_person_id INT NOT NULL,
  assign_role VARCHAR(16) NOT NULL DEFAULT '服务',
  source VARCHAR(16) NOT NULL,
  assigned_via_role VARCHAR(32) NULL,
  active INT NOT NULL,
  assigned_at VARCHAR(32) NOT NULL,
  deactivated_at VARCHAR(32) NULL,
  active_member_key INT GENERATED ALWAYS AS (CASE WHEN active = 1 THEN member_id ELSE NULL END) STORED,
  CHECK (assign_role = '服务'),
  CHECK (source IN ('指定', '默认', '红娘领取')),
  CHECK (assigned_via_role IS NULL OR assigned_via_role IN ('matchmanager', 'shop_manager', 'director', '红娘领取')),
  CHECK (active IN (0, 1)),
  UNIQUE (member_id),
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (order_id) REFERENCES order_facts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE service_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  shop_id INT NOT NULL,
  member_id INT NOT NULL,
  order_id INT NOT NULL,
  status VARCHAR(16) NOT NULL,
  planned_start VARCHAR(32) NULL,
  started_on VARCHAR(32) NULL,
  ended_on VARCHAR(32) NULL,
  total_end VARCHAR(32) NULL,
  duration_months INT NULL,
  activity_total INT NOT NULL DEFAULT 0,
  activity_used INT NOT NULL DEFAULT 0,
  emotion_total INT NOT NULL DEFAULT 0,
  emotion_used INT NOT NULL DEFAULT 0,
  one_on_one_total INT NOT NULL DEFAULT 0,
  one_on_one_used INT NOT NULL DEFAULT 0,
  image_total INT NOT NULL DEFAULT 0,
  image_used INT NOT NULL DEFAULT 0,
  opened_by VARCHAR(64) NULL,
  open_audit TEXT NULL,
  completed_lookup VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN status = '完成' THEN CONCAT(tenant_id, ':', member_id, ':', order_id) ELSE NULL END
  ) STORED,
  CHECK (status IN ('待启用', '启用中', '暂停', '失效', '完成')),
  CHECK (activity_total >= 0),
  CHECK (activity_used >= 0),
  CHECK (emotion_total >= 0),
  CHECK (emotion_used >= 0),
  CHECK (one_on_one_total >= 0),
  CHECK (one_on_one_used >= 0),
  CHECK (image_total >= 0),
  CHECK (image_used >= 0),
  CHECK (
    status NOT IN ('启用中', '暂停')
    OR (started_on IS NOT NULL AND ended_on IS NOT NULL)
  ),
  UNIQUE (order_id),
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (order_id) REFERENCES order_facts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  member_id INT NOT NULL,
  order_id INT NOT NULL,
  type VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  consent INT NULL,
  reason TEXT NULL,
  service_person_id INT NULL,
  closed_by INT NULL,
  gift_end_days INT NULL,
  gift_total_end_days INT NULL,
  gift_quota_kind VARCHAR(16) NULL,
  gift_quota_add INT NULL,
  payload TEXT NULL,
  pause_start VARCHAR(32) NULL,
  pause_end VARCHAR(32) NULL,
  resumed_at VARCHAR(32) NULL,
  remaining_months INT NULL,
  created_at VARCHAR(32) NOT NULL,
  decided_at VARCHAR(32) NULL,
  close_approved_key VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN type = '关单' AND status = '通过' THEN CONCAT(member_id, ':', IFNULL(decided_at, '')) ELSE NULL END
  ) STORED,
  CHECK (type IN ('关单', '赠送', '暂停')),
  CHECK (status IN ('待审', '待二审', '通过', '驳回')),
  CHECK (consent IS NULL OR consent IN (0, 1)),
  CHECK (gift_quota_kind IS NULL OR gift_quota_kind IN ('活动', '恋爱指导', '一对一', '形象')),
  CHECK (type = '关单' OR status != '待二审'),
  CHECK (
    type != '关单'
    OR status != '通过'
    OR (
      consent IS NOT NULL
      AND reason IS NOT NULL
      AND CHAR_LENGTH(reason) > 0
      AND service_person_id IS NOT NULL
      AND closed_by IS NOT NULL
    )
  ),
  CHECK (
    type != '暂停'
    OR status != '通过'
    OR (pause_start IS NOT NULL AND pause_end IS NOT NULL)
  ),
  CHECK (resumed_at IS NULL OR remaining_months IS NOT NULL),
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (order_id) REFERENCES order_facts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE recommendations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  member_id INT NOT NULL,
  guest_member_id INT NOT NULL,
  progress TEXT NULL,
  reason TEXT NULL,
  highlights TEXT NULL,
  hidden_points TEXT NULL,
  created_at VARCHAR(32) NOT NULL,
  UNIQUE (member_id, guest_member_id),
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (guest_member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE meetings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  service_member_id INT NOT NULL,
  member_id INT NULL,
  external_name VARCHAR(255) NULL,
  meet_on VARCHAR(32) NULL,
  place VARCHAR(255) NULL,
  member_status VARCHAR(64) NULL,
  object_status VARCHAR(64) NULL,
  result VARCHAR(64) NULL,
  feedback TEXT NULL,
  created_at VARCHAR(32) NOT NULL,
  CHECK (member_id IS NOT NULL OR (external_name IS NOT NULL AND CHAR_LENGTH(external_name) > 0)),
  FOREIGN KEY (service_member_id) REFERENCES members(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  member_id INT NOT NULL,
  body TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  FOREIGN KEY (member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  shop_id INT NOT NULL,
  member_id INT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  order_id INT NULL,
  guest_member_id INT NULL,
  reason TEXT NULL,
  highlights TEXT NULL,
  hidden_points TEXT NULL,
  progress TEXT NULL,
  created_at VARCHAR(32) NOT NULL,
  closed_at VARCHAR(32) NULL,
  open_rec_draft_key VARCHAR(128) GENERATED ALWAYS AS (
    CASE WHEN kind = '推荐草稿' AND status = '待确认' THEN CONCAT(member_id, ':', guest_member_id) ELSE NULL END
  ) STORED,
  open_close_suggestion_key INT GENERATED ALWAYS AS (
    CASE WHEN kind = '关单建议' AND status = '待确认' THEN order_id ELSE NULL END
  ) STORED,
  CHECK (kind IN ('推荐草稿', '关单建议')),
  CHECK (status IN ('待确认', '已确认', '已关闭')),
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (guest_member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE close_vip_contract (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  member_id INT NOT NULL,
  service_person_id INT NULL,
  order_id INT NOT NULL,
  service_start VARCHAR(32) NULL,
  service_end VARCHAR(32) NULL,
  letter_url TEXT NULL,
  status VARCHAR(64) NOT NULL,
  remark TEXT NULL,
  created_at VARCHAR(32) NOT NULL,
  UNIQUE (order_id),
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (order_id) REFERENCES order_facts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE outbox_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  type VARCHAR(64) NOT NULL,
  member_id INT NOT NULL,
  order_id INT NOT NULL,
  worker_id INT NOT NULL,
  payload TEXT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  consumed_at VARCHAR(32) NULL,
  FOREIGN KEY (member_id) REFERENCES members(id),
  FOREIGN KEY (order_id) REFERENCES order_facts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE deal_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  shop_id INT NOT NULL,
  member_id INT NOT NULL,
  person_id INT NOT NULL,
  role VARCHAR(16) NOT NULL,
  source VARCHAR(16) NOT NULL,
  active INT NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  deactivated_at VARCHAR(32) NULL,
  CHECK (role IN ('销售', '邀约')),
  CHECK (source IN ('成交遗留', '关单后领取')),
  CHECK (active IN (0, 1)),
  FOREIGN KEY (member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE member_profiles (
  member_id INT PRIMARY KEY,
  name VARCHAR(64) NULL,
  age INT NULL,
  city VARCHAR(64) NULL,
  job VARCHAR(64) NULL,
  schedule VARCHAR(128) NULL,
  emotional_need VARCHAR(255) NULL,
  strengths VARCHAR(255) NULL,
  taboos VARCHAR(255) NULL,
  disclosure_boundary VARCHAR(255) NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'manual',
  updated_at VARCHAR(32) NOT NULL,
  CHECK (source IN ('manual', 'sync')),
  FOREIGN KEY (member_id) REFERENCES members(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ai_invocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  caller_id INT NULL,
  purpose VARCHAR(64) NOT NULL,
  model VARCHAR(64) NOT NULL,
  latency_ms INT NOT NULL,
  prompt_tokens INT NULL,
  completion_tokens INT NULL,
  context_hash CHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_instances_member ON service_instances(member_id);
CREATE INDEX idx_instances_tenant_status ON service_instances(tenant_id, status);
CREATE INDEX idx_instances_completed ON service_instances(completed_lookup);
CREATE INDEX idx_close_approved ON applications(close_approved_key);
CREATE INDEX idx_ownership_active_member ON service_ownerships(active_member_key);
CREATE INDEX idx_applications_order ON applications(order_id, type, status);
CREATE INDEX idx_meetings_service_member ON meetings(service_member_id);
CREATE INDEX idx_outbox_order ON outbox_events(order_id, type);
CREATE INDEX idx_deal_member_active ON deal_assignments(member_id, active);
CREATE UNIQUE INDEX idx_open_recommendation_draft ON tasks(open_rec_draft_key);
CREATE UNIQUE INDEX idx_open_close_suggestion ON tasks(open_close_suggestion_key);
`;
