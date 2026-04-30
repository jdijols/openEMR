export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'claim'; text: string; citation_ids?: string[] };

export type RedeemResponse = {
  session_token: string;
  identity: {
    user_id: number;
    patient_uuid_present: boolean;
    encounter_id_present: boolean;
  };
  expires_at: string;
};

export type ChatResponse = {
  ok: true;
  blocks: ChatBlock[];
  correlation_id: string;
};
