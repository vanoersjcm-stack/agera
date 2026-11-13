-- Test 1a round 3: integrated party name on integration keys.
ALTER TABLE api_keys ADD COLUMN party_name VARCHAR(150);
UPDATE api_keys SET party_name = name WHERE party_name IS NULL;
