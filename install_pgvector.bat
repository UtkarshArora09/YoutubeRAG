@echo off
:: This script copies pgvector files to the PostgreSQL 18 directory and restarts the service.
:: It must be run as Administrator.

set "SRC=C:\Users\Utkar\Downloads\youtube-rag\pgvector_extracted"
set "DEST=C:\Program Files\PostgreSQL\18"

:: Check for administrative privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ========================================================
    echo ERROR: You must run this script as an ADMINISTRATOR!
    echo Right-click this file and select "Run as administrator".
    echo ========================================================
    pause
    exit /b 1
)

echo.
echo ========================================================
echo Installing pgvector to PostgreSQL 18
echo ========================================================
echo Source: %SRC%
echo Destination: %DEST%
echo.

echo [1/3] Copying lib\vector.dll...
copy "%SRC%\lib\vector.dll" "%DEST%\lib\" /Y
if %errorlevel% neq 0 goto error

echo [2/3] Copying extension SQL and control files...
copy "%SRC%\share\extension\*" "%DEST%\share\extension\" /Y
if %errorlevel% neq 0 goto error

echo [3/3] Copying header files (optional)...
mkdir "%DEST%\include\server\extension\vector" 2>nul
copy "%SRC%\include\server\extension\vector\*" "%DEST%\include\server\extension\vector\" /Y >nul

echo.
echo ========================================================
echo Restarting PostgreSQL 18 Service...
echo ========================================================
net stop postgresql-x64-18
net start postgresql-x64-18

echo.
echo ========================================================
echo SUCCESS: pgvector has been installed successfully!
echo ========================================================
pause
exit /b 0

:error
echo.
echo ========================================================
echo ERROR: Failed to copy files. 
echo Please ensure that PostgreSQL is not locking the files and
echo that you ran this script as Administrator.
echo ========================================================
pause
exit /b 1
