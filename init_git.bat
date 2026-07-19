@echo off
echo ==================================================
echo   QuickMart BI - Git Initialization Tool
echo ==================================================
echo.

echo [1/3] Initializing local Git repository...
git init

echo [2/3] Adding project files...
git add .

echo [3/3] Committing files...
git commit -m "feat: complete BI dashboard for deployment"

echo.
echo ==================================================
echo   SUCCESS: Local commit completed successfully!
echo ==================================================
echo.
echo   Next steps:
echo   1. Create a repository on github.com (taobao-bi-engine)
echo   2. Run the following commands in this terminal:
echo.
echo      git branch -M main
echo      git remote add origin YOUR_GITHUB_URL
echo      git push -u origin main
echo.
echo ==================================================
pause
