-- Sequential affiliate codes: ZB + 5 digits (ZB10001, ZB10002, ...).
-- Starts at 10001 so codes never overlap order numbers, which start at ZB81000 and only count up.
CREATE SEQUENCE IF NOT EXISTS zb_affiliate_code_seq START WITH 10001;
