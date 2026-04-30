# Contract Management — Production

Streamlit app for contract status management, deployed on Streamlit Community Cloud.

## Stack
- Frontend: Streamlit (Python)
- Storage: Microsoft Fabric OneLake (Delta Lake)
- Auth: Azure AD client credentials

## Setup
1. Add `.streamlit/secrets.toml` with Azure AD credentials (not committed)
2. `pip install -r requirements.txt`
3. `streamlit run app.py`
