# Target remote host and directory
remote_host := "broconne@aiscatcher.dc.home"
remote_dir := "~/aiscatcher-remote"

# Default recipe lists available tasks
default:
    @just --list

# Sync local source changes to the remote Pi (excludes build directories, git, and node_modules)
sync:
    @echo "Syncing files to {{remote_host}}:{{remote_dir}}..."
    rsync -avz --delete \
        --exclude='.git/' \
        --exclude='.jj/' \
        --exclude='build/' \
        --exclude='node_modules/' \
        --exclude='.gitignore.bak' \
        --exclude='frontend/dist/' \
        ./ {{remote_host}}:{{remote_dir}}/

# Build the Web frontend assets and bake them into C++ Source/Application/WebDB.cpp remotely
build-frontend: sync
    @echo "Building frontend and baking assets remotely..."
    ssh {{remote_host}} "export NVM_DIR=\$HOME/.nvm; [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\"; cd {{remote_dir}} && ./scripts/build-html.sh"

# Run cmake and make remotely inside the build folder
build-backend: sync
    @echo "Compiling backend remotely..."
    ssh {{remote_host}} "mkdir -p {{remote_dir}}/build && cd {{remote_dir}}/build && cmake .. -DNMEA2000_PATH=.. && make -j\$(nproc)"

# Compile everything (frontend + backend) remotely
build-all: build-frontend build-backend

# Sync, build all components, and deploy remotely for testing
test: sync build-all deploy


# Clean up remote build directory
build-clean:
    @echo "Cleaning up remote build directory..."
    ssh {{remote_host}} "rm -rf {{remote_dir}}/build"

# Deploy the compiled binary to the system path and restart the service
deploy:
    @echo "Deploying new binary and restarting ais-catcher.service..."
    ssh {{remote_host}} "sudo systemctl stop ais-catcher.service && sudo cp {{remote_dir}}/build/AIS-catcher /usr/bin/AIS-catcher && sudo systemctl start ais-catcher.service"

# Check the systemd service status on the Pi
status:
    @ssh -t {{remote_host}} "systemctl status ais-catcher.service"

# View system journal logs for the service
logs:
    @ssh -t {{remote_host}} "journalctl -u ais-catcher.service -f -n 100"
