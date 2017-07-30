import bindAll from 'lodash.bindall';
import debounce from 'lodash.debounce';
import defaultsDeep from 'lodash.defaultsdeep';
import PropTypes from 'prop-types';
import React from 'react';
import VMScratchBlocks from '../lib/blocks';
import VM from 'scratch-vm';
import Prompt from './prompt.jsx';
import BlocksComponent from '../components/blocks/blocks.jsx';
import Peer from 'peerjs';

const addFunctionListener = (object, property, callback) => {
    const oldFn = object[property];
    object[property] = function () {
        const result = oldFn.apply(this, arguments);
        callback.apply(this, result);
        return result;
    };
};

class Blocks extends React.Component {
    constructor (props) {
        super(props);
        this.ScratchBlocks = VMScratchBlocks(props.vm);
        bindAll(this, [
            'attachVM',
            'syncWorkspace',
            'detachVM',
            'handlePromptStart',
            'handlePromptCallback',
            'handlePromptClose',
            'onScriptGlowOn',
            'onScriptGlowOff',
            'onBlockGlowOn',
            'onBlockGlowOff',
            'onTargetsUpdate',
            'onVisualReport',
            'onWorkspaceUpdate',
            'onWorkspaceMetricsChange',
            'setBlocks'
        ]);
        this.ScratchBlocks.prompt = this.handlePromptStart;
        this.state = {
            workspaceMetrics: {},
            prompt: null
        };
        this.onTargetsUpdate = debounce(this.onTargetsUpdate, 100);
    }
    componentDidMount () {
        const workspaceConfig = defaultsDeep({}, Blocks.defaultOptions, this.props.options);
        this.workspace = this.ScratchBlocks.inject(this.blocks, workspaceConfig);

        // @todo change this when blockly supports UI events
        addFunctionListener(this.workspace, 'translate', this.onWorkspaceMetricsChange);
        addFunctionListener(this.workspace, 'zoom', this.onWorkspaceMetricsChange);

        this.attachVM();
    }
    shouldComponentUpdate (nextProps, nextState) {
        return this.state.prompt !== nextState.prompt || this.props.isVisible !== nextProps.isVisible;
    }
    componentDidUpdate (prevProps) {
        if (this.props.isVisible === prevProps.isVisible) {
            return;
        }

        // @todo hack to resize blockly manually in case resize happened while hidden
        // @todo hack to reload the workspace due to gui bug #413
        if (this.props.isVisible) { // Scripts tab
            this.workspace.setVisible(true);
            this.props.vm.refreshWorkspace();
            window.dispatchEvent(new Event('resize'));
            this.workspace.toolbox_.refreshSelection();
        } else {
            this.workspace.setVisible(false);
        }
    }
    componentWillUnmount () {
        this.detachVM();
        this.workspace.dispose();
    }
    attachVM () {
        this.workspace.addChangeListener(this.props.vm.blockListener);
        this.flyoutWorkspace = this.workspace
            .getFlyout()
            .getWorkspace();
        this.flyoutWorkspace.addChangeListener(this.props.vm.flyoutBlockListener);
        this.flyoutWorkspace.addChangeListener(this.props.vm.monitorBlockListener);
        this.props.vm.addListener('SCRIPT_GLOW_ON', this.onScriptGlowOn);
        this.props.vm.addListener('SCRIPT_GLOW_OFF', this.onScriptGlowOff);
        this.props.vm.addListener('BLOCK_GLOW_ON', this.onBlockGlowOn);
        this.props.vm.addListener('BLOCK_GLOW_OFF', this.onBlockGlowOff);
        this.props.vm.addListener('VISUAL_REPORT', this.onVisualReport);
        this.props.vm.addListener('workspaceUpdate', this.onWorkspaceUpdate);
        this.props.vm.addListener('targetsUpdate', this.onTargetsUpdate);

        {
            // uuidv4 source: StackOverflow @author: broofa: https://stackoverflow.com/a/2117523
            function uuidv4() {

                return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
                );
            }
            // end uuidv4

            // Parse Url for a remote connection string
            function getUUIDFromUrl() {

                var pos = location.href.indexOf("?");
                if (pos === -1) return undefined;
                else {
                    var uuid_remote = undefined;
                    location.href.substr(pos+1).split("&").forEach(function(pair) {
                    
                    var key = pair.substr(0, pair.indexOf("="));
                    var val = pair.substr(pair.indexOf("=")+1);

                    console.log("key: " + key + " val: " + val);

                    if (key === "uuid") uuid_remote = val;
                    });
                    return uuid_remote;
                }
            }

            var uuid_remote = getUUIDFromUrl(); 

            // Generate our uuid and update url with it.
            this.uuid = uuidv4();
            this.peers = [];
            console.log("peers: " + this.peers);
            window.history.replaceState("", "", "?uuid=" + this.uuid)

            // Start connection and listening receivers for peer-to-peer connections with clients.
            // Basic workplace syncing.
            this.peer = new Peer(this.uuid, {host: '45.55.148.206', port: 9000, path: ''});

            this.peer.on('open', function(id) {

                console.log("Connected with Server: id: " + id);
            });

            (function(parent) {

                parent.peer.on('connection', function(conn) {

                    (function(parent) {

                        conn.on('data', function(data){

                            console.log("Received peer data: " + data);
                            //TODO: this is broken endless loop between peers updating gui (need to add some checking)
                            //parent.ScratchBlocks.Events.fromJson(data, parent.workspace).run(true);
                        });
                    })(parent);
                    
                    if (!parent.peers.includes(conn.peer)) parent.peers.push(parent.peer.connect(conn.peer));
                });
            })(this);

            if (uuid_remote !== undefined) {

                if (!this.peers.includes(uuid_remote)) {
                    
                    var conn = this.peer.connect(uuid_remote);

                    (function(parent) {
                        
                        conn.on('data', function(data) {

                            console.log("Received peer data: " + data);
                            //TODO: this is broken endless loop between peers updating gui (need to add some checking)
                            //parent.ScratchBlocks.Events.fromJson(data, parent.workspace).run(true);
                        });
                    })(this);

                    this.peers.push(conn);
                }
            }

            this.workspace.addChangeListener(this.syncWorkspace)
        }
        
    }
    syncWorkspace(event) {
        //if (event.type == Blockly.Events.UI) { //TODO: don't have access to this variable Events.UI?
        if (event.type == this.ScratchBlocks.Events.UI) {
            return;  // Don't mirror UI events.
        }

        var json = event.toJson();
        console.log(json);

        this.peers.forEach(function(conn) {

            conn.send(json);
        });
    }
    detachVM () {
        this.props.vm.removeListener('SCRIPT_GLOW_ON', this.onScriptGlowOn);
        this.props.vm.removeListener('SCRIPT_GLOW_OFF', this.onScriptGlowOff);
        this.props.vm.removeListener('BLOCK_GLOW_ON', this.onBlockGlowOn);
        this.props.vm.removeListener('BLOCK_GLOW_OFF', this.onBlockGlowOff);
        this.props.vm.removeListener('VISUAL_REPORT', this.onVisualReport);
        this.props.vm.removeListener('workspaceUpdate', this.onWorkspaceUpdate);
        this.props.vm.removeListener('targetsUpdate', this.onTargetsUpdate);
    }
    updateToolboxBlockValue (id, value) {
        const block = this.workspace
            .getFlyout()
            .getWorkspace()
            .getBlockById(id);
        if (block) {
            block.inputList[0].fieldRow[0].setValue(value);
        }
    }
    onTargetsUpdate () {
        if (this.props.vm.editingTarget) {
            ['glide', 'move', 'set'].forEach(prefix => {
                this.updateToolboxBlockValue(`${prefix}x`, this.props.vm.editingTarget.x.toFixed(0));
                this.updateToolboxBlockValue(`${prefix}y`, this.props.vm.editingTarget.y.toFixed(0));
	    });
        }
    }
    onWorkspaceMetricsChange () {
        const target = this.props.vm.editingTarget;
        if (target && target.id) {
            const workspaceMetrics = Object.assign({}, this.state.workspaceMetrics, {
                [target.id]: {
                    scrollX: this.workspace.scrollX,
                    scrollY: this.workspace.scrollY,
                    scale: this.workspace.scale
                }
            });
            this.setState({workspaceMetrics});
        }
    }
    onScriptGlowOn (data) {
        this.workspace.glowStack(data.id, true);
    }
    onScriptGlowOff (data) {
        this.workspace.glowStack(data.id, false);
    }
    onBlockGlowOn (data) {
        this.workspace.glowBlock(data.id, true);
    }
    onBlockGlowOff (data) {
        this.workspace.glowBlock(data.id, false);
    }
    onVisualReport (data) {
        this.workspace.reportValue(data.id, data.value);
    }
    onWorkspaceUpdate (data) {
        if (this.props.vm.editingTarget && !this.state.workspaceMetrics[this.props.vm.editingTarget.id]) {
            this.onWorkspaceMetricsChange();
        }

        this.ScratchBlocks.Events.disable();
        this.workspace.clear();

        const dom = this.ScratchBlocks.Xml.textToDom(data.xml);
        this.ScratchBlocks.Xml.domToWorkspace(dom, this.workspace);
        this.ScratchBlocks.Events.enable();
        this.workspace.toolbox_.refreshSelection();

        if (this.props.vm.editingTarget && this.state.workspaceMetrics[this.props.vm.editingTarget.id]) {
            const {scrollX, scrollY, scale} = this.state.workspaceMetrics[this.props.vm.editingTarget.id];
            this.workspace.scrollX = scrollX;
            this.workspace.scrollY = scrollY;
            this.workspace.scale = scale;
            this.workspace.resize();
        }
    }
    setBlocks (blocks) {
        this.blocks = blocks;
    }
    handlePromptStart (message, defaultValue, callback) {
        this.setState({prompt: {callback, message, defaultValue}});
    }
    handlePromptCallback (data) {
        this.state.prompt.callback(data);
        this.handlePromptClose();
        console.log("onTargetUpdate");
    }
    handlePromptClose () {
        this.setState({prompt: null});
    }
    render () {
        const {
            options, // eslint-disable-line no-unused-vars
            vm, // eslint-disable-line no-unused-vars
            isVisible, // eslint-disable-line no-unused-vars
            ...props
        } = this.props;
        return (
            <div>
                <BlocksComponent
                    componentRef={this.setBlocks}
                    {...props}
                />
                {this.state.prompt ? (
                    <Prompt
                        label={this.state.prompt.message}
                        placeholder={this.state.prompt.defaultValue}
                        title="New Variable" // @todo the only prompt is for new variables
                        onCancel={this.handlePromptClose}
                        onOk={this.handlePromptCallback}
                    />
                ) : null}
            </div>
        );
    }
}

Blocks.propTypes = {
    isVisible: PropTypes.bool.isRequired,
    options: PropTypes.shape({
        media: PropTypes.string,
        zoom: PropTypes.shape({
            controls: PropTypes.bool,
            wheel: PropTypes.bool,
            startScale: PropTypes.number
        }),
        colours: PropTypes.shape({
            workspace: PropTypes.string,
            flyout: PropTypes.string,
            toolbox: PropTypes.string,
            toolboxSelected: PropTypes.string,
            scrollbar: PropTypes.string,
            scrollbarHover: PropTypes.string,
            insertionMarker: PropTypes.string,
            insertionMarkerOpacity: PropTypes.number,
            fieldShadow: PropTypes.string,
            dragShadowOpacity: PropTypes.number
        }),
        comments: PropTypes.bool
    }),
    vm: PropTypes.instanceOf(VM).isRequired
};

Blocks.defaultOptions = {
    zoom: {
        controls: true,
        wheel: true,
        startScale: 0.675
    },
    grid: {
        spacing: 40,
        length: 2,
        colour: '#ddd'
    },
    colours: {
        workspace: '#F9F9F9',
        flyout: '#F9F9F9',
        toolbox: '#FFFFFF',
        toolboxSelected: '#E9EEF2',
        scrollbar: '#CECDCE',
        scrollbarHover: '#CECDCE',
        insertionMarker: '#000000',
        insertionMarkerOpacity: 0.2,
        fieldShadow: 'rgba(255, 255, 255, 0.3)',
        dragShadowOpacity: 0.6
    },
    comments: false
};

Blocks.defaultProps = {
    options: Blocks.defaultOptions
};

export default Blocks;
